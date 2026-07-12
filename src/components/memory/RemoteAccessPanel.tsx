import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  clipboardWrite,
  getRemoteAccessStatus,
  testRemoteMcpConnection,
  toggleRemoteAccess,
  type RemoteAccessStatus,
  type RemoteConnectionTest,
} from "../../lib/tauri";
import { Button, StatusChip, Toggle } from "./settings/primitives";

interface Props {
  mode: "compact" | "full";
}

const REMOTE_QUERY_KEY = ["remote-access-status"] as const;

/** Shared Remote Access control surface used by the onboarding wizard
 *  (compact mode) and the full Settings page (full mode). Owns the toggle,
 *  status indicator, URL copy affordance, test-connection probe, setup
 *  instructions, and — in full mode — reconnect controls plus tunnel-behavior
 *  context. Reads `RemoteAccessStatus` via React Query and invalidates on
 *  `remote-access-status` events so both consumers stay in sync. */
export function RemoteAccessPanel({ mode }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: status = { status: "off" } as RemoteAccessStatus } = useQuery({
    queryKey: REMOTE_QUERY_KEY,
    queryFn: getRemoteAccessStatus,
    staleTime: 30_000,
    refetchInterval: false,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<RemoteAccessStatus>("remote-access-status", (event) => {
      queryClient.setQueryData(REMOTE_QUERY_KEY, event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => toggleRemoteAccess(enabled),
    onSuccess: (next) => {
      queryClient.setQueryData(REMOTE_QUERY_KEY, next);
    },
  });

  const [urlCopied, setUrlCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [testResult, setTestResult] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; latency_ms: number | null }
    | { kind: "err"; error: string }
  >({ kind: "idle" });

  const testOkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (testOkTimerRef.current) clearTimeout(testOkTimerRef.current);
      if (urlCopyTimerRef.current) clearTimeout(urlCopyTimerRef.current);
    };
  }, []);

  const testMut = useMutation({
    mutationFn: testRemoteMcpConnection,
    onMutate: () => {
      setTestResult({ kind: "running" });
    },
    onSuccess: (result: RemoteConnectionTest) => {
      if (result.ok) {
        setTestResult({ kind: "ok", latency_ms: result.latency_ms });
        if (testOkTimerRef.current) clearTimeout(testOkTimerRef.current);
        testOkTimerRef.current = setTimeout(
          () => setTestResult({ kind: "idle" }),
          2000,
        );
      } else {
        setTestResult({ kind: "err", error: result.error ?? "Unknown error" });
      }
    },
    onError: (err) => {
      setTestResult({ kind: "err", error: String(err) });
    },
  });

  const isOn = status.status === "connected" || status.status === "starting";
  const displayUrl =
    status.status === "connected"
      ? status.relay_url ?? `${status.tunnel_url}/mcp`
      : "";

  const handleCopyUrl = () => {
    clipboardWrite(displayUrl);
    setUrlCopied(true);
    if (urlCopyTimerRef.current) clearTimeout(urlCopyTimerRef.current);
    urlCopyTimerRef.current = setTimeout(() => setUrlCopied(false), 2000);
  };

  const handleReconnect = () => {
    toggleMut.mutate(false);
    setTimeout(() => toggleMut.mutate(true), 500);
  };

  return (
    <div
      className="rounded-xl"
      style={{
        backgroundColor: "var(--mem-surface)",
        border: "1px solid var(--mem-border)",
      }}
    >
      {/* Toggle row */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "var(--mem-text-lg)",
                fontWeight: 600,
                color: "var(--mem-text)",
              }}
            >
              {t("remoteAccess.title")}
            </div>
            <p
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "12px",
                color: "var(--mem-text-tertiary)",
                marginTop: "2px",
                lineHeight: "1.5",
              }}
            >
              {t("remoteAccess.noAuthWarning")}
            </p>
          </div>
          <div className="mt-0.5">
            <Toggle enabled={isOn} onToggle={() => toggleMut.mutate(!isOn)} />
          </div>
        </div>
      </div>

      {/* Status row */}
      <div className="px-5 pb-4">
        <StatusRow status={status} />
      </div>

      {/* Connected: URL + test connection */}
      {status.status === "connected" && (
        <div className="px-5 pb-4 space-y-3">
          <div>
            <label
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--mem-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {status.relay_url ? t("remoteAccess.urlLabelStable") : t("remoteAccess.urlLabel")}
            </label>
            <div className="flex items-center gap-2 mt-1">
              <pre
                style={{
                  fontFamily: "var(--mem-font-mono)",
                  fontSize: "var(--mem-text-sm)",
                  color: "var(--mem-text)",
                  backgroundColor: "var(--mem-hover)",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  flex: 1,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {displayUrl}
              </pre>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t("remoteAccess.copyUrl")}
                onClick={handleCopyUrl}
              >
                {urlCopied ? t("remoteAccess.copied") : t("remoteAccess.copyUrl")}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={testResult.kind === "running"}
              onClick={() => testMut.mutate()}
            >
              {testResult.kind === "running"
                ? t("remoteAccess.testing")
                : t("remoteAccess.testConnection")}
            </Button>
            {testResult.kind === "ok" && (
              <span
                className="inline-flex items-center gap-1"
                style={{
                  fontFamily: "var(--mem-font-body)",
                  fontSize: "12px",
                  color: "var(--mem-accent-sage)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {t("remoteAccess.statusConnectedLatency", { ms: testResult.latency_ms ?? "?" })}
              </span>
            )}
            {testResult.kind === "err" && (
              <span
                className="inline-flex items-center gap-1"
                style={{
                  fontFamily: "var(--mem-font-body)",
                  fontSize: "12px",
                  color: "var(--mem-status-danger-text)",
                }}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                {testResult.error}
              </span>
            )}
          </div>

          <InstructionsBlock
            expanded={showInstructions}
            onToggle={() => setShowInstructions((v) => !v)}
          />

          {mode === "full" && (
            <div className="flex items-center gap-3 pt-1">
              <Button
                variant="secondary"
                size="sm"
                loading={toggleMut.isPending}
                onClick={handleReconnect}
              >
                {t("remoteAccess.reconnect")}
              </Button>
              <p
                style={{
                  fontFamily: "var(--mem-font-body)",
                  fontSize: "11px",
                  color: "var(--mem-text-tertiary)",
                  lineHeight: "1.6",
                  margin: 0,
                }}
              >
                {status.relay_url
                  ? t("remoteAccess.stableNote")
                  : t("remoteAccess.tunnelChangesNote")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error / disabled reconnect (full mode shows reconnect button) */}
      {status.status === "error" && (
        <div className="px-5 pb-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => toggleMut.mutate(true)}>
              {t("remoteAccess.retry")}
            </Button>
            {mode === "full" && (
              <Button variant="secondary" size="sm" onClick={handleReconnect}>
                {t("remoteAccess.reconnect")}
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === "full" && status.status === "off" && (
        <div className="px-5 pb-4">
          <Button variant="secondary" size="sm" onClick={handleReconnect}>
            {t("remoteAccess.reconnect")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusRow({ status }: { status: RemoteAccessStatus }) {
  const { t } = useTranslation();
  // "off" is a setting the user chose, not something the app probed — the
  // chip-never-lies invariant means a chip's color may only come from an
  // observation, so off gets no chip at all (the Toggle already says it).
  if (status.status === "off") return null;
  if (status.status === "starting") {
    return <StatusChip state={{ kind: "probing" }} label={t("remoteAccess.statusConnecting")} />;
  }
  if (status.status === "connected") {
    return <StatusChip state={{ kind: "up" }} label={t("remoteAccess.statusConnected")} />;
  }
  // error — the verbatim daemon error carries the chip; there is no honest
  // constant word to put beside it, so it stands alone as the label.
  return <StatusChip state={{ kind: "down" }} label={status.error} />;
}

function InstructionsBlock({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 transition-colors"
        style={{
          fontFamily: "var(--mem-font-body)",
          fontSize: "12px",
          color: "var(--mem-text-tertiary)",
        }}
      >
        <svg
          className="w-3 h-3 transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        {t("remoteAccess.howTo")}
      </button>
      {expanded && (
        <div
          className="mt-2 space-y-3 pl-4"
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-sm)",
            color: "var(--mem-text-secondary)",
            lineHeight: "1.5",
          }}
        >
          <div>
            <div style={{ color: "var(--mem-text)", fontWeight: 500 }}>
              {t("remoteAccess.claudeAi")}
            </div>
            <div style={{ color: "var(--mem-text-secondary)" }}>
              {t("remoteAccess.claudeSteps")}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--mem-text)", fontWeight: 500 }}>
              {t("remoteAccess.chatGpt")}
            </div>
            <div style={{ color: "var(--mem-text-secondary)" }}>
              {t("remoteAccess.chatgptSteps")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
