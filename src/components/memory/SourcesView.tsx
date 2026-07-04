// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listRegisteredSources,
  syncRegisteredSource,
  openFile,
  readSourceDir,
  removeSource,
  listIndexedFiles,
  type RegisteredSource,
  type SourceDirEntry,
  type SyncStatusStr,
} from "../../lib/tauri";
import AddSourceMenu from "./sources/AddSourceMenu";
import { toast } from "sonner";

// The daemon's directory-ingest filter (wenlan-core sources/directory.rs).
// Files with these extensions feed the wiki; everything else is shown but dimmed.
const SUPPORTED_EXTENSIONS = ["md", "txt", "pdf"];

function folderName(p: string): string {
  return p.split("/").filter(Boolean).pop() || p;
}

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Collapse the daemon's SyncStatus enum to a short label, or null when Active. */
function statusLabel(status: SyncStatusStr): string | null {
  if (status === "Active") return null;
  if (status === "Paused") return "Paused";
  if (typeof status === "object" && "Unavailable" in status) return "Unavailable";
  return "Sync error";
}

const STATUS_COLORS: Record<string, string> = {
  Paused: "var(--mem-accent-amber)",
  "Sync error": "#ef4444",
  Unavailable: "var(--mem-text-tertiary)",
};

export type SpineVisual = "ghost" | "indexing" | "settled";

/** Ingest state for the spine (§Signature). Determinate percent is impossible
 *  (daemon reports no per-source total); the fill means "still arriving". */
export function spineVisual(s: RegisteredSource, prevMemoryCount: number | undefined): SpineVisual {
  if (s.last_sync === null) return s.memory_count === 0 ? "ghost" : "indexing";
  if (prevMemoryCount !== undefined && s.memory_count > prevMemoryCount) return "indexing";
  return "settled";
}

/** Mono caption under a source: Indexing… while settling, else "N notes" (+ skipped). */
export function spineCaption(s: RegisteredSource): string {
  if (s.last_sync === null) return "Indexing…";
  const skipped = s.last_sync_errors ?? 0;
  const notes = `${s.memory_count.toLocaleString()} notes`;
  return skipped > 0 ? `${notes}, ${skipped} skipped` : notes;
}

function relTime(ts: number | null): string {
  if (!ts) return "never synced";
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60) return "synced just now";
  if (secs < 3600) return `synced ${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `synced ${Math.floor(secs / 3600)}h ago`;
  return `synced ${Math.floor(secs / 86400)}d ago`;
}

interface SourcesViewProps {
  /** Settings › Sources, for remove and advanced source management. */
  onManageSources: () => void;
}

export default function SourcesView({ onManageSources }: SourcesViewProps) {
  // null = the Sources root (no auto-select — the design's whole point is
  // that opening the screen doesn't bury the drill-in tree one level down).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subpath, setSubpath] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: fetchedSources = [] } = useQuery({
    queryKey: ["registeredSources"],
    queryFn: listRegisteredSources,
    // Refetch fast while anything is still settling; slow when idle (§3).
    refetchInterval: (q) => {
      const list = (q.state.data as RegisteredSource[] | undefined) ?? [];
      return list.some((s) => s.last_sync === null) ? 3000 : 10000;
    },
  });
  const sources: RegisteredSource[] = fetchedSources;

  // The app-managed uploads dir (`upload_source_file` stages loose files
  // there and registers the whole dir as a directory source). It never
  // appears as a folder row — its contents surface as peer file rows instead.
  const managed = useMemo(
    () => sources.find((s) => /\.wenlan\/sources\/?$/.test(s.path)),
    [sources],
  );
  // Tallest first — most-memoried source on top, same as the old shelf order.
  const folderSources = useMemo(
    () =>
      sources
        .filter((s) => s.id !== managed?.id)
        .sort((a, b) => b.memory_count - a.memory_count),
    [sources, managed],
  );

  const selected: RegisteredSource | undefined = sources.find((s) => s.id === selectedId);

  function selectSource(id: string) {
    setSelectedId(id);
    setSubpath([]);
    setFilter("");
  }

  function goToRoot() {
    setSelectedId(null);
    setSubpath([]);
    setFilter("");
  }

  if (sources.length === 0) {
    return (
      <>
        <EmptyShelf onAdd={() => setAdding(true)} />
        {adding && <AddSourceMenu onClose={() => setAdding(false)} />}
      </>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {selected ? (
        <FolderBrowser
          key={selected.id}
          source={selected}
          subpath={subpath}
          onSubpath={setSubpath}
          filter={filter}
          onFilter={setFilter}
          onRoot={goToRoot}
        />
      ) : (
        <RootBrowser
          sourceCount={sources.length}
          folderSources={folderSources}
          managed={managed}
          onSelectSource={selectSource}
          onAdd={() => setAdding(true)}
          onManageSources={onManageSources}
        />
      )}

      {adding && <AddSourceMenu onClose={() => setAdding(false)} />}
    </div>
  );
}

interface RootBrowserProps {
  sourceCount: number;
  /** Non-managed sources (directory + obsidian), sorted by memory_count desc. */
  folderSources: RegisteredSource[];
  /** The app-managed uploads dir, if registered. Its loose files render as
   *  peer file rows; the dir itself is never a folder row. */
  managed: RegisteredSource | undefined;
  onSelectSource: (id: string) => void;
  onAdd: () => void;
  onManageSources: () => void;
}

/** The Sources root: a single list of folder rows (one per non-managed
 *  source) followed by file rows for loose uploads sitting directly in the
 *  managed dir — folders and files as peers, per the drill-in tree design. */
function RootBrowser({
  sourceCount,
  folderSources,
  managed,
  onSelectSource,
  onAdd,
  onManageSources,
}: RootBrowserProps) {
  // Single-click selects a loose file, double-click opens it — same rule as
  // FolderBrowser's file rows.
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const { data: managedEntries } = useQuery({
    queryKey: ["sourceDir", managed?.path],
    queryFn: () => readSourceDir(managed!.path),
    enabled: managed !== undefined,
  });
  const looseFiles = useMemo(
    () =>
      (managedEntries ?? [])
        .filter((e) => !e.isDirectory)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [managedEntries],
  );

  // Same cross-ref FolderBrowser uses, so loose uploads get the same
  // "Indexing…" badge as files inside a drilled-in folder.
  const { data: indexedFiles } = useQuery({
    queryKey: ["indexedFiles"],
    queryFn: listIndexedFiles,
  });
  const indexReady = indexedFiles !== undefined;
  const indexedPaths = useMemo(() => {
    const set = new Set<string>();
    if (!managed) return set;
    const prefix = `${managed.id}::`;
    for (const f of indexedFiles ?? []) {
      if (f.source_id.startsWith(prefix)) set.add(f.source_id.slice(prefix.length));
    }
    return set;
  }, [indexedFiles, managed]);

  // Rendered outside the JSX so `m` (unlike `managed`) is a definite
  // RegisteredSource inside the nested .map callback closures.
  let looseFileRows: React.ReactNode[] = [];
  if (managed) {
    const m = managed;
    looseFileRows = looseFiles.map((f) => {
      const supported = SUPPORTED_EXTENSIONS.includes(ext(f.name));
      const indexing = supported && indexReady && !indexedPaths.has([m.path, f.name].join("/"));
      const selected = selectedName === f.name;
      return (
        <FileRow
          key={f.name}
          name={f.name}
          selected={selected}
          indexing={indexing}
          supported={supported}
          onSelect={() => setSelectedName(f.name)}
          onOpen={() => openFile([m.path, f.name].join("/"))}
        />
      );
    });
  }

  return (
    <section className="flex-1 flex flex-col overflow-hidden">
      {/* Header: title, count, add / manage — moved here from the old shelf footer. */}
      <div className="px-8 pt-6 pb-4" style={{ borderBottom: "1px solid var(--mem-border)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div
              style={{
                fontFamily: "var(--mem-font-heading)",
                fontSize: "18px",
                fontWeight: 500,
                color: "var(--mem-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Sources
            </div>
            <div
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontSize: "11px",
                color: "var(--mem-text-tertiary)",
                marginTop: 6,
              }}
            >
              {sourceCount} {sourceCount === 1 ? "source" : "sources"}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onAdd}
              className="rounded-md border border-dashed transition-colors duration-150"
              style={{
                padding: "6px 13px",
                fontFamily: "var(--mem-font-body)",
                fontSize: "12px",
                color: "var(--mem-text-tertiary)",
                borderColor: "var(--mem-border)",
                background: "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--mem-accent-indigo)";
                e.currentTarget.style.color = "var(--mem-accent-indigo)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--mem-border)";
                e.currentTarget.style.color = "var(--mem-text-tertiary)";
              }}
            >
              + Add source
            </button>
            <button
              onClick={onManageSources}
              className="rounded-md transition-colors duration-150 hover:bg-[var(--mem-hover)]"
              style={{
                padding: "6px 11px",
                fontFamily: "var(--mem-font-body)",
                fontSize: "11.5px",
                color: "var(--mem-text-tertiary)",
                background: "transparent",
                border: "1px solid var(--mem-border)",
                cursor: "pointer",
              }}
            >
              Manage sources ⚙
            </button>
          </div>
        </div>
      </div>

      {/* Entries: folder sources first, then loose uploads as peers. */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="flex flex-col">
          {folderSources.map((s) => {
            const label = statusLabel(s.status);
            return (
              <button
                key={s.id}
                onClick={() => onSelectSource(s.id)}
                title={label ? `${s.path} · ${label}` : s.path}
                className="w-full flex items-center gap-3 rounded-md text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
                style={{ padding: "8px 10px" }}
              >
                <FileGlyph isDir supported={false} />
                <span
                  className="flex-1 min-w-0 truncate"
                  style={{
                    fontFamily: "var(--mem-font-body)",
                    fontSize: "13.5px",
                    color: "var(--mem-text)",
                  }}
                >
                  {folderName(s.path)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mem-font-mono)",
                    fontSize: "10.5px",
                    color: label ? STATUS_COLORS[label] : "var(--mem-text-tertiary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label ?? spineCaption(s)}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mem-text-tertiary)" }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            );
          })}
          {looseFileRows}
        </div>
      </div>
    </section>
  );
}

interface FolderBrowserProps {
  source: RegisteredSource;
  subpath: string[];
  onSubpath: (p: string[]) => void;
  filter: string;
  onFilter: (v: string) => void;
  /** Back to the Sources root (drill-in tree's top level). */
  onRoot: () => void;
}

function FolderBrowser({ source, subpath, onSubpath, filter, onFilter, onRoot }: FolderBrowserProps) {
  const queryClient = useQueryClient();
  const [syncedFlash, setSyncedFlash] = useState(false);
  // Single-click selects a file (safe — no accidental external open); double-click
  // opens it. Reset when the folder changes so a name can't stay selected across dirs.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const fullPath = [source.path, ...subpath].join("/");
  useEffect(() => setSelectedName(null), [fullPath]);

  const {
    data: entries,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["sourceDir", fullPath],
    queryFn: async (): Promise<SourceDirEntry[]> => {
      const raw = await readSourceDir(fullPath);
      return [...raw].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
  });

  // Which files the daemon actually indexed. The daemon silently drops files
  // it can't extract text from (e.g. a scanned PDF), so the folder listing can
  // show files that never made it into the library — surface that here instead
  // of leaving the count quietly wrong.
  // ponytail: pulls the whole indexed-file list to cross-ref one folder; fine
  // at localhost/desktop scale, add a per-source endpoint if it ever drags.
  const { data: indexedFiles } = useQuery({
    queryKey: ["indexedFiles"],
    queryFn: listIndexedFiles,
  });
  const indexReady = indexedFiles !== undefined;
  const indexedPaths = useMemo(() => {
    const prefix = `${source.id}::`;
    const set = new Set<string>();
    for (const f of indexedFiles ?? []) {
      if (f.source_id.startsWith(prefix)) set.add(f.source_id.slice(prefix.length));
    }
    return set;
  }, [indexedFiles, source.id]);
  const isIndexed = (name: string) => indexedPaths.has([fullPath, name].join("/"));
  // Ground truth for "how many files are here" is the on-disk listing, not the
  // daemon's source.file_count (whole-source, and known to miscount — it drops
  // files it can't extract text from without adjusting the total).
  const fileCount = (entries ?? []).filter((e) => !e.isDirectory).length;
  // Supported files not yet in the index. On a directory source the daemon
  // auto-syncs, so these are almost always mid-flight rather than failures —
  // call it "Indexing…", not the alarming "not indexed".
  // ponytail: no per-file mtime in the listing, so a genuinely unreadable file
  // (e.g. a scanned PDF) reads as "Indexing…" indefinitely; add per-file status
  // to the DTO if we ever need to call out permanent skips.
  const indexingCount = indexReady
    ? (entries ?? []).filter(
        (e) => !e.isDirectory && SUPPORTED_EXTENSIONS.includes(ext(e.name)) && !isIndexed(e.name),
      ).length
    : 0;

  const syncMutation = useMutation({
    mutationFn: () => syncRegisteredSource(source.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registeredSources"] });
      queryClient.invalidateQueries({ queryKey: ["sourceDir"] });
      setSyncedFlash(true);
      setTimeout(() => setSyncedFlash(false), 1600);
    },
  });

  const q = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter((e) => !q || e.name.toLowerCase().includes(q));
  const label = statusLabel(source.status);

  return (
    <section className="flex-1 flex flex-col overflow-hidden">
      {/* Header: breadcrumb + actions */}
      <div className="px-8 pt-6 pb-4" style={{ borderBottom: "1px solid var(--mem-border)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap" style={{ minHeight: 22 }}>
              <button
                onClick={onRoot}
                className="transition-colors duration-150 hover:text-[var(--mem-text)]"
                style={{
                  fontFamily: "var(--mem-font-body)",
                  fontSize: "14px",
                  color: "var(--mem-text-secondary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Sources
              </button>
              <span style={{ color: "var(--mem-text-tertiary)", fontSize: 13 }}>/</span>
              <button
                onClick={() => onSubpath([])}
                className="transition-colors duration-150 hover:text-[var(--mem-text)]"
                style={{
                  fontFamily: "var(--mem-font-heading)",
                  fontSize: "18px",
                  fontWeight: 500,
                  color: subpath.length === 0 ? "var(--mem-text)" : "var(--mem-text-secondary)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  letterSpacing: "-0.01em",
                }}
              >
                {folderName(source.path)}
              </button>
              {subpath.map((seg, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span style={{ color: "var(--mem-text-tertiary)", fontSize: 13 }}>/</span>
                  <button
                    onClick={() => onSubpath(subpath.slice(0, i + 1))}
                    className="transition-colors duration-150 hover:text-[var(--mem-text)]"
                    style={{
                      fontFamily: "var(--mem-font-body)",
                      fontSize: "14px",
                      color:
                        i === subpath.length - 1
                          ? "var(--mem-text)"
                          : "var(--mem-text-secondary)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>
            <div
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontSize: "11px",
                color: label ? STATUS_COLORS[label] : "var(--mem-text-tertiary)",
                marginTop: 6,
              }}
            >
              {source.source_type === "obsidian" ? "Obsidian vault" : "Folder"}
              {" · "}
              {fileCount.toLocaleString()} {fileCount === 1 ? "file" : "files"}
              {" · "}
              {source.memory_count.toLocaleString()} memories
              {indexingCount > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "var(--mem-text-tertiary)" }}>
                    {indexingCount.toLocaleString()} indexing
                  </span>
                </>
              )}
              {" · "}
              {label ?? relTime(source.last_sync)}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                const name = folderName(source.path);
                if (
                  !window.confirm(
                    `Remove ${name}? Indexed notes stay in your library; this source stops syncing.`,
                  )
                )
                  return;
                removeSource(source.id)
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: ["registeredSources"] });
                  })
                  .catch((e) => {
                    toast("Couldn't remove source", { description: String(e) });
                  });
              }}
              className="rounded-md transition-colors duration-150 hover:bg-[var(--mem-hover)]"
              style={{
                padding: "6px 11px",
                fontFamily: "var(--mem-font-body)",
                fontSize: "12px",
                color: "var(--mem-text-secondary)",
                background: "transparent",
                border: "1px solid var(--mem-border)",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
            <button
              onClick={() => openFile(fullPath)}
              className="rounded-md transition-colors duration-150 hover:bg-[var(--mem-hover)]"
              title="Reveal in Finder"
              style={{
                padding: "6px 11px",
                fontFamily: "var(--mem-font-body)",
                fontSize: "12px",
                color: "var(--mem-text-secondary)",
                background: "transparent",
                border: "1px solid var(--mem-border)",
                cursor: "pointer",
              }}
            >
              Reveal
            </button>
            {source.source_type === "obsidian" ? (
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="rounded-md transition-colors duration-150"
                style={{
                  padding: "6px 13px",
                  fontFamily: "var(--mem-font-body)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "white",
                  background: "var(--mem-accent-indigo)",
                  border: "none",
                  cursor: syncMutation.isPending ? "default" : "pointer",
                  opacity: syncMutation.isPending ? 0.6 : 1,
                }}
              >
                {syncedFlash ? "✓ Synced" : syncMutation.isPending ? "Syncing…" : "Sync"}
              </button>
            ) : (
              <div className="flex flex-col items-end" style={{ maxWidth: 200 }}>
                <span
                  style={{
                    fontFamily: "var(--mem-font-mono)",
                    fontSize: "11px",
                    color: "var(--mem-text-tertiary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Auto-synced{source.last_sync ? ` · updated ${relTime(source.last_sync).replace(/^synced /, "")}` : ""}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mem-font-body)",
                    fontSize: "11px",
                    color: "var(--mem-text-tertiary)",
                    marginTop: 4,
                    lineHeight: 1.4,
                    textAlign: "right",
                  }}
                >
                  Syncs in the background, even when Wenlan is closed.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar: filter */}
      <div className="px-8 pt-3 pb-2">
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter this folder…"
          className="w-full rounded-md transition-colors duration-150"
          style={{
            padding: "6px 10px",
            fontFamily: "var(--mem-font-mono)",
            fontSize: "12px",
            color: "var(--mem-text)",
            background: "var(--mem-surface)",
            border: "1px solid var(--mem-border)",
            outline: "none",
          }}
        />
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {isLoading ? (
          <SkeletonRows />
        ) : isError ? (
          <FolderError onReveal={() => openFile(fullPath)} atRoot={subpath.length === 0} />
        ) : shown.length === 0 ? (
          <EmptyLine text={q ? `No matches for “${filter}”.` : "This folder is empty."} />
        ) : (
          <div className="flex flex-col">
            {shown.map((e) => {
              if (e.isDirectory) {
                return (
                  <button
                    key={e.name}
                    onClick={() => onSubpath([...subpath, e.name])}
                    className="w-full flex items-center gap-3 rounded-md text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
                    style={{ padding: "8px 10px" }}
                  >
                    <FileGlyph isDir supported={false} />
                    <span
                      className="flex-1 min-w-0 truncate"
                      style={{ fontFamily: "var(--mem-font-body)", fontSize: "13.5px", color: "var(--mem-text)" }}
                    >
                      {e.name}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mem-text-tertiary)" }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              }
              const supported = SUPPORTED_EXTENSIONS.includes(ext(e.name));
              // A supported file not yet in the index — on an auto-syncing
              // directory source this means the daemon hasn't reached it yet.
              // Gated on indexReady so nothing is flagged while the indexed-file
              // list is still loading.
              const indexing = supported && indexReady && !isIndexed(e.name);
              const selected = selectedName === e.name;
              return (
                <FileRow
                  key={e.name}
                  name={e.name}
                  selected={selected}
                  indexing={indexing}
                  supported={supported}
                  onSelect={() => setSelectedName(e.name)}
                  onOpen={() => openFile([fullPath, e.name].join("/"))}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

interface FileRowProps {
  name: string;
  selected: boolean;
  /** Supported, not yet in the daemon's index — shows the calm "Indexing…" badge. */
  indexing: boolean;
  supported: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/** A single file row: single-click selects, double-click opens via `openFile`.
 *  Shared between FolderBrowser (files inside a drilled-in source) and
 *  RootBrowser (loose uploads sitting directly in the managed dir) so both
 *  stay visually and behaviorally identical. */
function FileRow({ name, selected, indexing, supported, onSelect, onOpen }: FileRowProps) {
  return (
    <button
      data-selected={selected ? "true" : undefined}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className="w-full flex items-center gap-3 rounded-md text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
      style={{ padding: "8px 10px", background: selected ? "var(--mem-indigo-bg)" : undefined }}
    >
      <FileGlyph isDir={false} supported={supported} />
      <span
        className="flex-1 min-w-0 truncate"
        style={{
          fontFamily: "var(--mem-font-body)",
          fontSize: "13.5px",
          color: indexing
            ? "var(--mem-text-tertiary)"
            : supported
              ? "var(--mem-text-secondary)"
              : "var(--mem-text-tertiary)",
        }}
      >
        {name}
      </span>
      {indexing && (
        <span
          title="Indexing… — not in your library yet."
          style={{
            fontFamily: "var(--mem-font-mono)",
            fontSize: "10px",
            letterSpacing: "0.02em",
            color: "var(--mem-text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          Indexing…
        </span>
      )}
      {ext(name) && (
        <span
          style={{
            fontFamily: "var(--mem-font-mono)",
            fontSize: "10px",
            letterSpacing: "0.04em",
            color: supported ? "var(--mem-accent-indigo)" : "var(--mem-text-tertiary)",
            opacity: supported ? 0.9 : 0.5,
          }}
        >
          {ext(name)}
        </span>
      )}
    </button>
  );
}

function FileGlyph({ isDir, supported }: { isDir: boolean; supported: boolean }) {
  if (isDir) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mem-accent-indigo)", opacity: 0.8 }}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: supported ? "var(--mem-text-secondary)" : "var(--mem-text-tertiary)", opacity: supported ? 0.85 : 0.5 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-2 pt-1">
      {[0.9, 0.7, 0.8, 0.55, 0.65].map((w, i) => (
        <div
          key={i}
          style={{
            height: 18,
            width: `${w * 100}%`,
            maxWidth: 320,
            borderRadius: 5,
            background: "var(--mem-shimmer-color)",
          }}
        />
      ))}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div
      className="pt-8"
      style={{ fontFamily: "var(--mem-font-body)", fontSize: "13px", color: "var(--mem-text-tertiary)" }}
    >
      {text}
    </div>
  );
}

function FolderError({ onReveal, atRoot }: { onReveal: () => void; atRoot: boolean }) {
  return (
    <div className="pt-8 flex flex-col items-start gap-3">
      <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "13px", color: "var(--mem-text-secondary)", maxWidth: 380, lineHeight: 1.55 }}>
        {atRoot
          ? "This source can't be read — the folder may have been moved, renamed, or unmounted."
          : "This folder can't be read — it may have been moved or renamed."}
      </p>
      <button
        onClick={onReveal}
        className="rounded-md transition-colors duration-150 hover:bg-[var(--mem-hover)]"
        style={{
          padding: "6px 12px",
          fontFamily: "var(--mem-font-body)",
          fontSize: "12px",
          color: "var(--mem-text-secondary)",
          background: "transparent",
          border: "1px solid var(--mem-border)",
          cursor: "pointer",
        }}
      >
        Reveal in Finder
      </button>
    </div>
  );
}

function EmptyShelf({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-8">
      <div className="flex flex-col items-center text-center" style={{ maxWidth: 420 }}>
        <h2
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "26px",
            fontWeight: 500,
            color: "var(--mem-text)",
            margin: "10px 0 0 0",
            letterSpacing: "-0.02em",
          }}
        >
          Nothing on the shelf yet
        </h2>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "14px",
            color: "var(--mem-text-secondary)",
            margin: "10px 0 22px 0",
            lineHeight: 1.6,
          }}
        >
          Wenlan builds its wiki from the folders and vaults you add here. Point it at a notes
          folder or an Obsidian vault to lay the first stone.
        </p>
        <button
          onClick={onAdd}
          className="rounded-md transition-colors duration-150"
          style={{
            padding: "9px 18px",
            fontFamily: "var(--mem-font-body)",
            fontSize: "13px",
            fontWeight: 500,
            color: "white",
            background: "var(--mem-accent-indigo)",
            border: "none",
            cursor: "pointer",
          }}
        >
          + Add your first source
        </button>
      </div>
    </div>
  );
}
