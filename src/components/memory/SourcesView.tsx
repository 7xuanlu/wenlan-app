// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listRegisteredSources,
  syncRegisteredSource,
  openFile,
  readSourceDir,
  type RegisteredSource,
  type SourceDirEntry,
  type SyncStatusStr,
} from "../../lib/tauri";
import AddSourceDialog from "./sources/AddSourceDialog";

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

/** Spine height in px: 12px floor, up to 30px for the largest source. The
 *  rail reads as a shelf of book-spines — height = share of ingested memory. */
function spineHeight(memoryCount: number, maxMemories: number): number {
  return 12 + Math.round(18 * (memoryCount / maxMemories));
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subpath, setSubpath] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: sources = [] } = useQuery({
    queryKey: ["registeredSources"],
    queryFn: listRegisteredSources,
    refetchInterval: 10000,
  });

  // Tallest spine first — the shelf reads as a clear silhouette, most
  // foundational source on top.
  const shelf = useMemo(
    () => [...sources].sort((a, b) => b.memory_count - a.memory_count),
    [sources],
  );
  const maxMemories = Math.max(...sources.map((s) => s.memory_count), 1);

  const selected: RegisteredSource | undefined =
    shelf.find((s) => s.id === selectedId) ?? shelf[0];

  function selectSource(id: string) {
    setSelectedId(id);
    setSubpath([]);
    setFilter("");
  }

  if (sources.length === 0) {
    return (
      <>
        <EmptyShelf onAdd={() => setAdding(true)} />
        {adding && (
          <AddSourceDialog onClose={() => setAdding(false)} onSuccess={() => setAdding(false)} />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── The shelf: source picker ── */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{ width: 260, borderRight: "1px solid var(--mem-border)" }}
      >
        <div className="px-5 pt-6 pb-3">
          <div
            style={{
              fontFamily: "var(--mem-font-mono)",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--mem-accent-indigo)",
              opacity: 0.9,
            }}
          >
            Foundation
          </div>
          <div
            style={{
              fontFamily: "var(--mem-font-mono)",
              fontSize: "11px",
              color: "var(--mem-text-tertiary)",
              marginTop: 4,
            }}
          >
            {sources.length} {sources.length === 1 ? "source" : "sources"}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-0.5">
          {shelf.map((s) => {
            const label = statusLabel(s.status);
            const active = selected?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => selectSource(s.id)}
                title={label ? `${s.path} · ${label}` : s.path}
                className="w-full flex items-center gap-3 rounded-md text-left transition-colors duration-150"
                style={{
                  padding: "9px 10px",
                  background: active ? "var(--mem-indigo-bg)" : "transparent",
                  borderLeft: `2px solid ${active ? "var(--mem-accent-indigo)" : "transparent"}`,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--mem-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Book spine: height = memory share, color = sync status. */}
                <span className="shrink-0 w-1.5 flex items-end justify-center" style={{ height: 30 }}>
                  <span
                    data-testid="source-spine"
                    style={{
                      width: 3,
                      borderRadius: 1.5,
                      height: spineHeight(s.memory_count, maxMemories),
                      backgroundColor: label ? STATUS_COLORS[label] : "var(--mem-accent-indigo)",
                      opacity: label ? 0.9 : active ? 0.85 : 0.5,
                    }}
                  />
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className="block truncate"
                    style={{
                      fontFamily: "var(--mem-font-heading)",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: active ? "var(--mem-text)" : "var(--mem-text-secondary)",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {folderName(s.path)}
                  </span>
                  <span
                    className="block truncate"
                    style={{
                      fontFamily: "var(--mem-font-mono)",
                      fontSize: "10.5px",
                      color: label ? STATUS_COLORS[label] : "var(--mem-text-tertiary)",
                      marginTop: 1,
                    }}
                  >
                    {label ?? `${s.memory_count.toLocaleString()} memories`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="px-3 py-3 flex flex-col gap-1"
          style={{ borderTop: "1px solid var(--mem-border)" }}
        >
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-md border border-dashed px-3 py-2 text-left transition-colors duration-150"
            style={{
              borderColor: "var(--mem-border)",
              fontFamily: "var(--mem-font-body)",
              fontSize: "12px",
              color: "var(--mem-text-tertiary)",
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
            className="w-full rounded-md px-3 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "11.5px",
              color: "var(--mem-text-tertiary)",
            }}
          >
            Manage sources ⚙
          </button>
        </div>
      </aside>

      {/* ── The open folder ── */}
      {selected && (
        <FolderBrowser
          key={selected.id}
          source={selected}
          subpath={subpath}
          onSubpath={setSubpath}
          filter={filter}
          onFilter={setFilter}
        />
      )}

      {adding && (
        <AddSourceDialog onClose={() => setAdding(false)} onSuccess={() => setAdding(false)} />
      )}
    </div>
  );
}

interface FolderBrowserProps {
  source: RegisteredSource;
  subpath: string[];
  onSubpath: (p: string[]) => void;
  filter: string;
  onFilter: (v: string) => void;
}

function FolderBrowser({ source, subpath, onSubpath, filter, onFilter }: FolderBrowserProps) {
  const queryClient = useQueryClient();
  const [syncedFlash, setSyncedFlash] = useState(false);
  const fullPath = [source.path, ...subpath].join("/");

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
              {source.file_count.toLocaleString()} files
              {" · "}
              {source.memory_count.toLocaleString()} memories
              {" · "}
              {label ?? relTime(source.last_sync)}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
              const isDir = e.isDirectory;
              const supported = !isDir && SUPPORTED_EXTENSIONS.includes(ext(e.name));
              return (
                <button
                  key={e.name}
                  onClick={() =>
                    isDir ? onSubpath([...subpath, e.name]) : openFile([fullPath, e.name].join("/"))
                  }
                  className="w-full flex items-center gap-3 rounded-md text-left transition-colors duration-150 hover:bg-[var(--mem-hover)]"
                  style={{ padding: "8px 10px" }}
                >
                  <FileGlyph isDir={isDir} supported={supported} />
                  <span
                    className="flex-1 min-w-0 truncate"
                    style={{
                      fontFamily: "var(--mem-font-body)",
                      fontSize: "13.5px",
                      color: isDir
                        ? "var(--mem-text)"
                        : supported
                          ? "var(--mem-text-secondary)"
                          : "var(--mem-text-tertiary)",
                    }}
                  >
                    {e.name}
                  </span>
                  {!isDir && ext(e.name) && (
                    <span
                      style={{
                        fontFamily: "var(--mem-font-mono)",
                        fontSize: "10px",
                        letterSpacing: "0.04em",
                        color: supported ? "var(--mem-accent-indigo)" : "var(--mem-text-tertiary)",
                        opacity: supported ? 0.9 : 0.5,
                      }}
                    >
                      {ext(e.name)}
                    </span>
                  )}
                  {isDir && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mem-text-tertiary)" }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
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
        <div
          style={{
            fontFamily: "var(--mem-font-mono)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--mem-accent-indigo)",
            opacity: 0.9,
          }}
        >
          Foundation
        </div>
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
