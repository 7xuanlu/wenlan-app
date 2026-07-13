import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  detectMcpClients,
  writeMcpConfig,
  installClientPlugin,
  listAgents,
  getWireState,
  downloadOnDeviceModel,
  getOnDeviceModel,
  onDeviceModelDownloadBytes,
  addSource,
  syncRegisteredSource,
  type McpClient,
  type ImportResult,
  type SyncStats,
} from "../lib/tauri";
import { ImportView } from "./memory/ImportView";
import VaultConnectCard, { type VaultPick } from "./memory/sources/VaultConnectCard";
import { isPluginClient } from "./connect/pluginClients";
import ClientRow, { clientRowDescId } from "./connect/ClientRow";
import { OnDeviceModelCard } from "./intelligence/IntelligenceSetup";
import type { PresetGroup } from "./intelligence/providerPresets";
import AnyProviderCard from "./intelligence/AnyProviderCard";
import { Button, Tag, SectionHeader } from "./memory/settings/primitives";
import { resolveAgentDisplayName } from "../lib/agents";

// Module-level so each is a stable reference across renders — AnyProviderCard
// memoizes its preset list on these, and a fresh array literal per render
// would defeat that memo (see the `groupsKey` comment in AnyProviderCard).
const CLOUD_GROUPS: PresetGroup[] = ["cloud"];
const LOCAL_GROUPS: PresetGroup[] = ["local", "custom"];

export type WizardStep =
  | "welcome"
  | "intelligence-choice"
  | "import"
  | "connect"
  | "setting-up"
  | "done";

interface SetupWizardProps {
  onComplete: () => void;
  initialStep?: WizardStep;
  // Preview-harness seams. The model and import rows of the setting-up step are
  // conditional on picks made in earlier steps, so entering at `setting-up`
  // renders neither — which made the two longest-running rows in the whole
  // wizard the only ones nobody could review without a real multi-minute
  // download. The app never passes these; ?model=/?import= in preview do.
  initialPendingModelId?: string | null;
  initialPendingImportPick?: VaultPick | null;
}

// Exported so the preview harness can drive the wizard by step without keeping
// its own copy. It used to keep a literal, which drifted when "verify" was
// renamed "setting-up" — and rather than the "visibly wrong tab" that was
// predicted, it silently made the setting-up step unreachable in preview.
export const STEP_ORDER: WizardStep[] = [
  "welcome",
  "intelligence-choice",
  "import",
  "connect",
  "setting-up",
  "done",
];

// ── Step Indicator ──────────────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-2">
      {STEP_ORDER.map((step, i) => (
        <div
          key={step}
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor:
              i <= currentIndex
                ? "var(--mem-accent-indigo)"
                : "var(--mem-hover-strong)",
            transition: "background-color 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

// ── Step Shell ──────────────────────────────────────────────────────────
// Structural fix for defect 5 ("actions clipped off-screen"): a fixed-height
// (100vh) flex column with a scrollable `main` and a 64px action bar that
// never scrolls out of view — every step's Back/Skip/Continue is visible by
// construction, regardless of content height. See design-spec.md §4.0.

interface StepShellAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

function StepShell({
  hideDots,
  activeStep,
  leftActions,
  primaryAction,
  children,
}: {
  hideDots: boolean;
  activeStep: WizardStep;
  leftActions?: StepShellAction[];
  primaryAction?: StepShellAction;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", backgroundColor: "var(--mem-bg)" }}
    >
      <div data-tauri-drag-region style={{ height: "32px", flexShrink: 0 }} />

      <main
        data-testid="wizard-scroll-main"
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-xl mx-auto" style={{ padding: "0 24px 32px" }}>
          {children}
        </div>
      </main>

      <div
        data-testid="wizard-action-bar"
        className="flex items-center shrink-0"
        style={{
          height: "64px",
          padding: "0 24px",
          borderTop: "1px solid var(--mem-border)",
          backgroundColor: "var(--mem-bg)",
        }}
      >
        <div className="flex items-center gap-2" style={{ minWidth: "60px" }}>
          {(leftActions ?? []).map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="md"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </Button>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-center">
          {!hideDots && <StepIndicator currentStep={activeStep} />}
        </div>
        <div
          style={{ minWidth: "60px", display: "flex", justifyContent: "flex-end" }}
        >
          {primaryAction && (
            <Button
              variant="primary"
              size="md"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              loading={primaryAction.loading}
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Welcome Step ────────────────────────────────────────────────────────

function WelcomeStep({ onNext, hideDots }: { onNext: () => void; hideDots: boolean }) {
  const { t } = useTranslation();

  return (
    <StepShell
      hideDots={hideDots}
      activeStep="welcome"
      primaryAction={{ label: t("setup.getStarted"), onClick: onNext }}
    >
    <div
      className="flex flex-col items-center text-center"
      style={{ gap: "32px", paddingTop: "80px" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h1
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "var(--mem-text-2xl)",
            fontWeight: 500,
            color: "var(--mem-text)",
            letterSpacing: "-0.02em",
          }}
        >
          {t("setup.welcomeTitle")}
        </h1>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-lg)",
            color: "var(--mem-text-secondary)",
            lineHeight: "1.5",
          }}
        >
          {t("setup.tagline")}
        </p>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-lg)",
            color: "var(--mem-text-secondary)",
            lineHeight: "1.5",
          }}
        >
          {t("setup.welcomeBody")}
        </p>
      </div>

      {/* Privacy badge */}
      <div
        className="flex items-center gap-2"
        style={{
          padding: "10px 16px",
          borderRadius: "10px",
          backgroundColor: "var(--mem-surface)",
          border: "1px solid var(--mem-border)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--mem-text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <span
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "13px",
            color: "var(--mem-text-secondary)",
          }}
        >
          {t("setup.privacyTitle")}
        </span>
      </div>
    </div>
    </StepShell>
  );
}

function IntelligenceChoiceStep({
  onNext,
  onBack,
  hideDots,
}: {
  // Carries the on-device model id iff the user is on the device path and
  // picked one — this step only records the choice; step 5 downloads it and
  // proves it loaded. Cloud/local API-key and local-server saves are instant
  // today and stay that way (unaffected).
  onNext: (deviceModelId: string | null) => void;
  onBack: () => void;
  hideDots: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"device" | "cloud" | "local">("device");
  const [deviceModelId, setDeviceModelId] = useState<string | null>(null);

  const handleContinue = () => onNext(mode === "device" ? deviceModelId : null);
  const handleSkip = () => onNext(null);

  const choiceButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 12px",
    borderRadius: "var(--mem-radius-md)",
    border: "1px solid var(--mem-border)",
    backgroundColor: active ? "var(--mem-indigo-bg)" : "var(--mem-surface)",
    color: active ? "var(--mem-accent-indigo)" : "var(--mem-text-secondary)",
    fontFamily: "var(--mem-font-body)",
    fontSize: "var(--mem-text-base)",
    fontWeight: 500,
    textAlign: "left",
  });

  const note = (
    key:
      | "setup.intelligence.deviceNote"
      | "setup.intelligence.cloudNote"
      | "setup.intelligence.localNote",
  ) => (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        backgroundColor: "var(--mem-hover)",
        border: "1px solid var(--mem-border)",
        fontFamily: "var(--mem-font-body)",
        fontSize: "var(--mem-text-sm)",
        color: "var(--mem-text-secondary)",
        lineHeight: 1.6,
      }}
    >
      {t(key)}
    </div>
  );

  return (
    <StepShell
      hideDots={hideDots}
      activeStep="intelligence-choice"
      leftActions={[
        { label: t("setup.back"), onClick: onBack },
        { label: t("setup.skip"), onClick: handleSkip },
      ]}
      primaryAction={{ label: t("setup.continue"), onClick: handleContinue }}
    >
    <div
      className="flex flex-col"
      style={{ gap: "24px", paddingTop: "24px" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h1
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "var(--mem-text-2xl)",
            fontWeight: 500,
            color: "var(--mem-text)",
          }}
        >
          {t("setup.intelligence.title")}
        </h1>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-base)",
            color: "var(--mem-text-secondary)",
            lineHeight: "1.5",
          }}
        >
          {t("setup.intelligence.description")}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setMode("device")}
          aria-pressed={mode === "device"}
          style={choiceButtonStyle(mode === "device")}
        >
          {t("setup.intelligence.deviceOption")}
          <span style={{ marginLeft: "8px" }}>
            <Tag tone="accent">{t("setup.intelligence.recommended")}</Tag>
          </span>
        </button>
        <button
          onClick={() => setMode("cloud")}
          aria-pressed={mode === "cloud"}
          style={choiceButtonStyle(mode === "cloud")}
        >
          {t("setup.intelligence.cloudOption")}
        </button>
        <button
          onClick={() => setMode("local")}
          aria-pressed={mode === "local"}
          style={choiceButtonStyle(mode === "local")}
        >
          {t("setup.intelligence.localOption")}
        </button>
      </div>

      {mode === "device" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <OnDeviceModelCard deferDownload onModelChosen={setDeviceModelId} />
          {note("setup.intelligence.deviceNote")}
        </div>
      )}

      {mode === "cloud" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <AnyProviderCard groups={CLOUD_GROUPS} />
          {note("setup.intelligence.cloudNote")}
        </div>
      )}

      {mode === "local" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <AnyProviderCard groups={LOCAL_GROUPS} />
          {note("setup.intelligence.localNote")}
        </div>
      )}
    </div>
    </StepShell>
  );
}

// ── Import Step (dual path: chat history | vault) ───────────────────────

function ImportStep({
  onBack,
  onAdvance,
  onComplete,
  onPhaseChange,
  importHint,
  hideDots,
}: {
  onBack: () => void;
  // This step only records a pick (or null); step 5 runs addSource +
  // syncRegisteredSource and shows the real SyncStats it gets back.
  onAdvance: (pick: VaultPick | null) => void;
  onComplete: (source: string, result: ImportResult) => void;
  onPhaseChange: (phase: string) => void;
  importHint: React.ReactNode;
  hideDots: boolean;
}) {
  const { t } = useTranslation();
  const [pathChoice, setPathChoice] = useState<"none" | "chat">("none");
  const [pick, setPick] = useState<VaultPick | null>(null);

  if (pathChoice === "chat") {
    // ImportView owns its own internal Back/Skip/Continue and layout math
    // (`calc(100vh - 120px)`); it is not migrated to StepShell (out of
    // scope — §4.3 "no structural redesign"). This wrapper reproduces the
    // same ~120px of chrome (drag region + optional dots) it always sat
    // under so its height math keeps working unmodified.
    return (
      <div className="flex flex-col" style={{ height: "100vh", backgroundColor: "var(--mem-bg)" }}>
        <div data-tauri-drag-region style={{ height: "32px", flexShrink: 0 }} />
        {!hideDots && <StepIndicator currentStep="import" />}
        <div
          className="flex-1"
          style={{ maxWidth: "640px", width: "100%", margin: "0 auto", padding: "0 24px 48px" }}
        >
          <ImportView
            onBack={() => setPathChoice("none")}
            wizardMode
            wizardHint={importHint}
            onPhaseChange={onPhaseChange}
            onSkip={() => onAdvance(null)}
            onComplete={onComplete}
          />
        </div>
      </div>
    );
  }

  return (
    <StepShell
      hideDots={hideDots}
      activeStep="import"
      leftActions={[
        { label: t("setup.back"), onClick: onBack },
        { label: t("setup.skip"), onClick: () => onAdvance(null) },
      ]}
      primaryAction={{ label: t("setup.continue"), onClick: () => onAdvance(pick) }}
    >
    <div className="flex flex-col" style={{ gap: "24px", paddingTop: "24px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h1 style={{ fontFamily: "var(--mem-font-heading)", fontSize: "var(--mem-text-2xl)", fontWeight: 500, color: "var(--mem-text)" }}>
          {t("setup.import.title")}
        </h1>
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "13px", color: "var(--mem-text-secondary)", lineHeight: "1.5" }}>
          {t("setup.import.description")}
        </p>
      </div>

      {/* Primary path: a real detected vault or folder, one tap away —
          shown first because it beats "if you already have a file" for
          most people. Records a pick only; step 5 runs it. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <VaultConnectCard variant="wizard" onPick={setPick} />
      </div>

      {/* Secondary path: for users who already exported their chat history. */}
      <div
        className="rounded-xl p-4 flex items-center justify-between"
        style={{ border: "1px solid var(--mem-border)", backgroundColor: "var(--mem-surface)", gap: "12px" }}
      >
        <div>
          <h3 style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-lg)", fontWeight: 600, color: "var(--mem-text)" }}>
            {t("setup.import.chatPathTitle")}
          </h3>
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", marginTop: "4px" }}>
            {t("setup.import.chatPathDescription")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setPathChoice("chat")} className="shrink-0">
          {t("setup.import.chatPathCta")}
        </Button>
      </div>
    </div>
    </StepShell>
  );
}

// ── Connect Step ────────────────────────────────────────────────────────

function ConnectStep({
  onNext,
  onBack,
  onConnected,
  hideDots,
}: {
  onNext: (selected: McpClient[]) => void;
  onBack: () => void;
  onConnected: (agents: string[]) => void;
  hideDots: boolean;
}) {
  const { t } = useTranslation();
  const [selectedClients, setSelectedClients] = useState<Record<string, boolean>>({});

  const { data: clients, isLoading, isError } = useQuery({
    queryKey: ["mcp-clients"],
    queryFn: detectMcpClients,
  });

  // This step asks; it never acts. Nothing here writes a config or installs
  // anything — every mutation happens on the next step, where the user can
  // watch it happen. Which is also why an already-configured client is not
  // frozen: it starts checked, but stays fully interactive, so the user can
  // uncheck a tool they'd rather Wenlan left alone.
  useEffect(() => {
    if (!clients) return;
    setSelectedClients((prev) => {
      const next = { ...prev };
      for (const client of clients) {
        if (next[client.client_type] === undefined) {
          next[client.client_type] = client.detected;
        }
      }
      return next;
    });
  }, [clients]);

  useEffect(() => {
    if (!clients) return;
    const configuredNames = clients
      .filter((client) => client.already_configured)
      .map((client) => client.client_type);
    if (configuredNames.length > 0) {
      onConnected(configuredNames);
    }
  }, [clients, onConnected]);

  const detectedClients = useMemo(
    () => (clients ?? []).filter((client) => client.detected),
    [clients],
  );

  const handleContinue = () => {
    onNext(
      detectedClients.filter((client) => selectedClients[client.client_type]),
    );
  };

  return (
    <StepShell
      hideDots={hideDots}
      activeStep="connect"
      leftActions={[
        { label: t("setup.back"), onClick: onBack },
        { label: t("setup.skip"), onClick: () => onNext([]) },
      ]}
      primaryAction={{
        label: t("setup.continue"),
        onClick: handleContinue,
      }}
    >
    <div
      className="flex flex-col"
      style={{ gap: "24px", paddingTop: "24px" }}
    >
      <div>
        <h1
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "var(--mem-text-2xl)",
            fontWeight: 500,
            color: "var(--mem-text)",
          }}
        >
          {t("setup.connect.title")}
        </h1>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-base)",
            color: "var(--mem-text-secondary)",
            marginTop: "4px",
            lineHeight: "1.5",
          }}
        >
          {t("setup.connect.description")}
        </p>
      </div>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <SectionHeader label={t("setup.connect.detectedOnMac")} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-xl"
                style={{
                  height: "72px",
                  backgroundColor: "var(--mem-surface)",
                  border: "1px solid var(--mem-border)",
                  opacity: 0.5,
                  animation: "pulse 1.6s ease-in-out infinite",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!isLoading && isError && (
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-base)",
            color: "var(--mem-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {t("setup.connect.detectionFailed")}
        </p>
      )}

      {!isLoading && !isError && detectedClients.length === 0 && (
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-base)",
            color: "var(--mem-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {t("setup.connect.emptyTitle")}
        </p>
      )}

      {!isLoading && detectedClients.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <SectionHeader label={t("setup.connect.detectedOnMac")} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {detectedClients.map((client) => {
              const isSelected = !!selectedClients[client.client_type];
              const isConfigured = client.already_configured;

              return (
                <ClientRow
                  key={client.client_type}
                  client={client}
                  configured={isConfigured}
                  selected={isSelected}
                  leading={
                    <input
                      type="checkbox"
                      aria-label={client.name}
                      aria-describedby={
                        isConfigured ? clientRowDescId(client.client_type) : undefined
                      }
                      checked={isSelected}
                      onChange={(e) =>
                        setSelectedClients((prev) => ({ ...prev, [client.client_type]: e.target.checked }))
                      }
                      style={{
                        width: "16px",
                        height: "16px",
                        accentColor: "var(--mem-accent-indigo)",
                        marginTop: "2px",
                      }}
                    />
                  }
                >
                  {isConfigured ? (
                    <p
                      style={{
                        fontFamily: "var(--mem-font-body)",
                        fontSize: "var(--mem-text-sm)",
                        color: "var(--mem-text-tertiary)",
                        lineHeight: "1.5",
                      }}
                    >
                      {t("setup.connect.alreadySetUp")}
                    </p>
                  ) : null}
                </ClientRow>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && (
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-sm)",
            color: "var(--mem-text-tertiary)",
            lineHeight: "1.5",
          }}
        >
          {t("setup.connect.settingsPointer")}
        </p>
      )}
    </div>
    </StepShell>
  );
}

// ── Setting Up Step ─────────────────────────────────────────────────────

type TaskStatus = "pending" | "running" | "done" | "failed";

const DAEMON_ROW_ID = "daemon";
const MODEL_ROW_ID = "on-device-model";
const IMPORT_ROW_ID = "import";

/** Centre of a rail node: 5px from the row's top, plus half of its 9px box.
 *  The spine is drawn between node centres, so both ends clamp to this. */
const NODE_CENTER_Y = 9.5;

/** A unit of work on the Setting up step. `client` is set only for
 *  plugin/config rows; the other kinds carry what they need through the
 *  step's own `pendingModelId` / `pendingImportPick` props instead. */
interface TaskRow {
  id: string;
  kind: "daemon" | "model" | "import" | "plugin" | "config";
  client: McpClient | null;
}

function taskRowDescId(rowId: string): string {
  return `setting-up-desc-${rowId}`;
}

function modelProgressDescId(rowId: string): string {
  return `setting-up-progress-${rowId}`;
}

/** One {time, bytes} sample from the download-bytes poll. */
interface ByteSample {
  t: number;
  bytes: number;
}

/** Bytes/sec between the oldest and newest kept sample, or `null` when there
 *  aren't at least two distinct samples yet, or the elapsed time or delta
 *  isn't positive (a stall or a clock/poll hiccup — never divide by ~0 or
 *  report a negative rate). */
function downloadRateBytesPerSec(samples: ByteSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedSec = (last.t - first.t) / 1000;
  if (elapsedSec <= 0) return null;
  const rate = (last.bytes - first.bytes) / elapsedSec;
  return rate > 0 ? rate : null;
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: "var(--mem-text-tertiary)",
  running: "var(--mem-text-secondary)",
  done: "var(--mem-status-success-text)",
  failed: "var(--mem-status-danger-text)",
};

/** Rail-node ring color per status — the inking-thread's node states. */
const NODE_RING_COLOR: Record<TaskStatus, string> = {
  pending: "var(--mem-border)",
  running: "var(--mem-accent-indigo)",
  done: "var(--mem-accent-sage)",
  failed: "var(--mem-status-danger-text)",
};

function SettingUpStep({
  selected,
  pendingModelId,
  pendingImportPick,
  onNext,
  onBack,
  onConnected,
  wizardEnteredAt,
  hideDots,
}: {
  selected: McpClient[];
  pendingModelId: string | null;
  pendingImportPick: VaultPick | null;
  onNext: () => void;
  onBack: () => void;
  onConnected: (agents: string[]) => void;
  wizardEnteredAt: number;
  hideDots: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const onConnectedRef = useRef(onConnected);
  useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);

  // Rows are computed ONCE, at step entry, and never re-derived — a detection
  // refetch mid-step must not add, drop, or reorder a row the user is watching.
  // Order: runtime first (nothing downstream can be true if the daemon isn't
  // up), then the on-device model (if chosen), then import (if chosen), then
  // each tool.
  //
  // The rail holds only work WENLAN does. The first-agent write used to be a
  // row here, but it is the one thing on this screen the machine cannot do:
  // it needs the user to go to another app and use it. As a row it could never
  // complete while being looked at, so the spine never finished inking and
  // onboarding's last impression was a checklist stuck at incomplete. It lives
  // below the rail now, as a handoff, and the rail can actually finish.
  const [rows] = useState<TaskRow[]>(() => {
    const out: TaskRow[] = [{ id: DAEMON_ROW_ID, kind: "daemon", client: null }];
    if (pendingModelId) out.push({ id: MODEL_ROW_ID, kind: "model", client: null });
    if (pendingImportPick) out.push({ id: IMPORT_ROW_ID, kind: "import", client: null });
    const plugins: TaskRow[] = [];
    const configs: TaskRow[] = [];
    for (const client of selected) {
      const plugin = isPluginClient(client.client_type);
      (plugin ? plugins : configs).push({
        id: client.client_type,
        kind: plugin ? "plugin" : "config",
        client,
      });
    }
    out.push(...plugins, ...configs);
    return out;
  });

  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, "pending" as TaskStatus])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importStats, setImportStats] = useState<SyncStats | null>(null);
  // Gates the model-load poll below: the download POST resolving is not
  // proof of anything — only `getOnDeviceModel().loaded` is.
  const [modelDownloadStarted, setModelDownloadStarted] = useState(false);

  // Runs exactly one row's work. Shared by the initial concurrent kickoff
  // and by Retry, so a retry re-exercises the same path a first attempt
  // would rather than a different, untested one.
  const runRow = useCallback(
    (row: TaskRow) => {
      setStatuses((prev) => ({ ...prev, [row.id]: "running" }));
      setErrors((prev) => {
        if (!(row.id in prev)) return prev;
        const next = { ...prev };
        delete next[row.id];
        return next;
      });

      if (row.kind === "plugin" || row.kind === "config") {
        const clientType = row.client!.client_type;
        // THE invariant: Claude Code and Codex get the plugin, never a raw MCP
        // entry. Both vendors' Wenlan plugins declare their own `mcpServers`, so
        // also writing `~/.claude.json` / `[mcp_servers.wenlan]` would register
        // the Wenlan server twice. `isPluginClient` is the single home for that
        // rule (src/components/connect/pluginClients.ts) — Settings obeys it too.
        const task = isPluginClient(clientType)
          ? installClientPlugin(clientType)
          : writeMcpConfig(clientType);
        task.then(
          () => {
            setStatuses((prev) => ({ ...prev, [row.id]: "done" }));
            onConnectedRef.current([clientType]);
            queryClient.invalidateQueries({ queryKey: ["mcp-clients"] });
          },
          (err) => {
            // A failed row never blocks the wizard: it shows its reason, stays
            // failed, and Continue stays live. No user is trapped in setup
            // because one editor's config file was read-only.
            setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
            setErrors((prev) => ({ ...prev, [row.id]: String(err) }));
          },
        );
        return;
      }

      if (row.kind === "daemon") {
        // First and unconditional: nothing downstream (model load, import,
        // any tool) can be true if the daemon itself isn't reachable.
        getWireState().then(
          (wire) => {
            if (wire.daemon.reachable) {
              setStatuses((prev) => ({ ...prev, [row.id]: "done" }));
            } else {
              setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
              setErrors((prev) => ({
                ...prev,
                [row.id]: wire.daemon.error ?? t("setup.settingUp.daemonUnreachable"),
              }));
            }
          },
          (err) => {
            setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
            setErrors((prev) => ({ ...prev, [row.id]: String(err) }));
          },
        );
        return;
      }

      if (row.kind === "model") {
        if (!pendingModelId) return;
        setModelDownloadStarted(false);
        downloadOnDeviceModel(pendingModelId).then(
          // Resolving here only means the request landed — not that the
          // model is loaded. The row stays "running"; the poll below (keyed
          // on modelDownloadStarted) is what actually proves it.
          () => setModelDownloadStarted(true),
          (err) => {
            setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
            setErrors((prev) => ({ ...prev, [row.id]: String(err) }));
          },
        );
        return;
      }

      if (row.kind === "import") {
        if (!pendingImportPick) return;
        addSource(pendingImportPick.sourceType, pendingImportPick.path)
          .then((source) => syncRegisteredSource(source.id))
          .then((stats) => {
            setImportStats(stats);
            setStatuses((prev) => ({ ...prev, [row.id]: "done" }));
            queryClient.invalidateQueries({ queryKey: ["registeredSources"] });
          })
          .catch((err) => {
            setStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
            setErrors((prev) => ({ ...prev, [row.id]: String(err) }));
          });
        return;
      }
    },
    [pendingModelId, pendingImportPick, queryClient, t],
  );

  // Concurrent, not sequential: one slow row must not hold up the others,
  // and a rejection must not cancel siblings. Fires once, at step entry —
  // the rendered order is `rows`, which is frozen.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    for (const row of rows) {
      runRow(row);
    }
  }, [rows, runRow]);

  // On-device model proof: poll until `loaded` matches what was chosen.
  //
  // Runs from the moment the row starts, NOT from when downloadOnDeviceModel()
  // resolves. That call is a single blocking request that only returns once the
  // download AND engine init have finished — minutes later. Gating this poll on
  // it meant `modelPoll` was undefined for the entire download, so `modelEntry`
  // was too, and every screen that needs the catalog mid-download (the size, the
  // Downloading-vs-Loading split, the byte progress bar) silently fell back to
  // generic copy. The download phase was unreachable in the app while rendering
  // fine under a mocked query in tests.
  const { data: modelPoll } = useQuery({
    queryKey: ["onDeviceModel", "wizard-setup-proof"],
    queryFn: getOnDeviceModel,
    enabled: statuses[MODEL_ROW_ID] === "running" || modelDownloadStarted,
    refetchInterval: 1500,
  });
  useEffect(() => {
    // The done-flip stays gated on modelDownloadStarted — that is what the gate
    // above was actually protecting: a poll landing before the download call
    // returns could otherwise see a `loaded` left over from a previous model and
    // mark the row done without this download ever finishing.
    if (!pendingModelId || !modelPoll || !modelDownloadStarted) return;
    if (modelPoll.loaded === pendingModelId) {
      setStatuses((prev) => (prev[MODEL_ROW_ID] === "done" ? prev : { ...prev, [MODEL_ROW_ID]: "done" }));
    }
  }, [modelPoll, pendingModelId, modelDownloadStarted]);

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    refetchInterval: 3000,
  });

  // Scoped to writes made SINCE the wizard was entered. A pre-existing write
  // proves some older install worked; it says nothing about the configs we
  // just wrote. The old VerifyStep accepted any past write and called onNext()
  // from an effect, which is why a returning user never saw this step at all.
  const freshAgents = useMemo(
    () =>
      (agents ?? []).filter(
        (a) => a.last_seen_at != null && a.last_seen_at > wizardEnteredAt,
      ),
    [agents, wizardEnteredAt],
  );
  const waitingDone = freshAgents.length > 0;

  // Resolves its own row and stops there. It never advances the wizard.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (notifiedRef.current || freshAgents.length === 0) return;
    notifiedRef.current = true;
    onConnectedRef.current(freshAgents.map((a) => a.name));
  }, [freshAgents]);

  const statusOf = (row: TaskRow): TaskStatus => statuses[row.id] ?? "pending";

  // The daemon reports no byte count, but it does report whether the file is
  // cached. That splits one undifferentiated spinner into the two waits the
  // user actually has — minutes of download, then seconds of load — and lets
  // the row name the real file size instead of "a few minutes".
  const modelEntry = modelPoll?.models.find((m) => m.id === pendingModelId);
  const modelDownloading = statuses[MODEL_ROW_ID] === "running" && !modelEntry?.cached;

  // The registry's `file_size_gb` is a rounded-up hand estimate, not the real
  // blob size — so it can only ever make the bar run early, never overshoot.
  // We read the true numerator (bytes actually on disk, from the hf-hub
  // cache's in-progress `.part` file) but must never claim a total: no "of
  // 2.7 GB" label, no bar that reaches 100% off this estimate alone. The row
  // only ever flips to done from the real `loaded` poll above, never because
  // this bar reached its end.
  const { data: downloadBytes } = useQuery({
    queryKey: ["onDeviceModel", "download-bytes"],
    queryFn: onDeviceModelDownloadBytes,
    enabled: modelDownloading,
    refetchInterval: 1000,
  });

  // A short rolling window, not the whole history: an average diluted by
  // stale samples from a slow start would lag a rate change. Cleared the
  // moment the phase ends so a re-download never opens on stale samples.
  const [byteSamples, setByteSamples] = useState<ByteSample[]>([]);
  useEffect(() => {
    if (!modelDownloading) {
      setByteSamples([]);
      return;
    }
    if (downloadBytes == null) return;
    setByteSamples((prev) => [...prev, { t: Date.now(), bytes: downloadBytes }].slice(-5));
  }, [modelDownloading, downloadBytes]);

  const downloadedGB = downloadBytes != null ? downloadBytes / 1e9 : null;
  // Gated on modelEntry the same way modelDownloadingSub already is below:
  // without it we have no estimated total, so there's nothing to derive a
  // fraction or an ETA from — only the existing modelSub/modelDownloadingSub
  // fallback copy applies there.
  const estimatedTotalBytes = modelEntry ? modelEntry.file_size_gb * 1e9 : null;
  const downloadRate = downloadRateBytesPerSec(byteSamples);
  const downloadEtaSeconds =
    downloadRate != null && estimatedTotalBytes != null && downloadBytes != null
      ? Math.max(0, (estimatedTotalBytes - downloadBytes) / downloadRate)
      : null;
  // Clamped below 100% even though the estimate can only run early: an
  // honest bar never visually finishes on an estimate, only on `loaded`.
  const downloadProgressFraction =
    estimatedTotalBytes && downloadBytes != null
      ? Math.min(downloadBytes / estimatedTotalBytes, 0.97)
      : null;

  const labelOf = (row: TaskRow): string => {
    if (row.kind === "daemon") return t("setup.settingUp.daemonLabel");
    if (row.kind === "model") return t("setup.settingUp.modelLabel");
    if (row.kind === "import") return t("setup.settingUp.importLabel");
    // One row, one config file, one plugin — and it covers ChatGPT desktop's
    // Codex pane as well, so the row says so rather than letting the user
    // hunt for a ChatGPT checkbox that would be a lie.
    if (row.id === "codex_cli") return t("setup.settingUp.codexLabel");
    return row.client!.name;
  };

  const subOf = (row: TaskRow): string => {
    if (row.kind === "daemon") return t("setup.settingUp.daemonSub");
    if (row.kind === "model") {
      if (statusOf(row) === "done") {
        return t("setup.settingUp.modelDoneSub", { model: pendingModelId ?? "" });
      }
      if (modelDownloading) {
        if (modelEntry && downloadedGB != null) {
          const done = downloadedGB.toFixed(1);
          if (downloadEtaSeconds != null) {
            const minutes = Math.round(downloadEtaSeconds / 60);
            return minutes < 1
              ? t("setup.settingUp.modelProgressSoon", { done })
              : t("setup.settingUp.modelProgressMinutes", { done, minutes });
          }
          return t("setup.settingUp.modelProgress", { done });
        }
        return modelEntry
          ? t("setup.settingUp.modelDownloadingSub", { size: modelEntry.file_size_gb })
          : t("setup.settingUp.modelSub");
      }
      return t("setup.settingUp.modelLoadingSub");
    }
    if (row.kind === "import") {
      if (statusOf(row) === "done" && importStats) {
        return t("setup.settingUp.importDoneSub", {
          ingested: importStats.ingested,
          skipped: importStats.skipped,
        });
      }
      return t("setup.settingUp.importSub", { name: pendingImportPick?.label ?? "" });
    }
    if (row.id === "codex_cli") return t("setup.settingUp.codexSub");
    if (row.kind === "plugin") {
      return t("setup.settingUp.pluginSub", { name: row.client!.name });
    }
    // "Adding Wenlan to X's configuration file" is a lie once it's added.
    return t(
      statusOf(row) === "done" ? "setup.settingUp.configDoneSub" : "setup.settingUp.configSub",
      { name: row.client!.name },
    );
  };

  const statusTextOf = (row: TaskRow): string => {
    const status = statusOf(row);
    if (status === "pending") return t("setup.settingUp.statusPending");
    if (status === "running") {
      // "Setting up…" for six minutes of model download is not a status, it's
      // a shrug. Name the phase the user is actually in.
      if (row.kind === "model") {
        return modelDownloading
          ? t("setup.settingUp.statusDownloading")
          : t("setup.settingUp.statusLoading");
      }
      if (row.kind === "import") return t("setup.settingUp.statusImporting");
      return t("setup.settingUp.statusRunning");
    }
    if (status === "done") {
      // A daemon is not "configured" — it runs. A model is ready; an import is
      // imported. One flat done-word for every row kind said the wrong thing
      // about three of them.
      if (row.kind === "daemon") return t("setup.settingUp.statusDoneDaemon");
      if (row.kind === "model") return t("setup.settingUp.statusDoneModel");
      if (row.kind === "import") return t("setup.settingUp.statusDoneImport");
      return t("setup.settingUp.statusDone");
    }
    return t("setup.settingUp.statusFailed");
  };

  const anyFailed = rows.some((row) => statusOf(row) === "failed");
  const anyRunning = rows.some((row) => statusOf(row) === "running");

  return (
    <StepShell
      hideDots={hideDots}
      activeStep="setting-up"
      leftActions={[{ label: t("setup.back"), onClick: onBack }]}
      primaryAction={{ label: t("setup.continue"), onClick: onNext }}
    >
    <div className="flex flex-col" style={{ gap: "24px", paddingTop: "24px" }}>
      <div>
        <h1
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "var(--mem-text-2xl)",
            fontWeight: 500,
            color: "var(--mem-text)",
          }}
        >
          {t("setup.settingUp.title")}
        </h1>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-base)",
            color: "var(--mem-text-secondary)",
            marginTop: "4px",
            lineHeight: "1.5",
          }}
        >
          {t("setup.settingUp.description")}
        </p>
      </div>

      {/* One polite live region over the whole list: a row's status text is the
          only thing that changes in it, so that is what gets announced. */}
      <div
        role="status"
        aria-live="polite"
        data-testid="setting-up-tasks"
        style={{ display: "flex", flexDirection: "column" }}
      >
        {rows.map((row, index) => {
          const status = statusOf(row);
          const error = errors[row.id];
          const canRetry = status === "failed";
          const isDone = status === "done";
          const isFirst = index === 0;
          const isLast = index === rows.length - 1;

          // Node centre is 9.5px down the row (node top 5px + half of 9px).
          // First row: spine leaves its node downward. Last row: spine arrives
          // at its node and stops. A lone row has no spine to draw at all.
          const hasRail = rows.length > 1;
          const railSpan = isLast
            ? { top: 0, height: `${NODE_CENTER_Y}px` }
            : { top: isFirst ? `${NODE_CENTER_Y}px` : 0, bottom: 0 };

          return (
            <div
              key={row.id}
              data-testid={`task-row-${row.id}`}
              className="flex items-start"
              style={{ gap: "var(--mem-space-3)" }}
            >
              {/* Rail + node: purely decorative — the row's own status text
                  and testids carry the meaning for assistive tech. Each row
                  owns only its own stretch of spine, inked independently of
                  its siblings — rows finish concurrently and out of order, so
                  this is never a contiguous top-down fill.

                  The spine runs node-centre to node-centre, and nowhere else.
                  It used to span each row's full box, which drew 9.5px of line
                  ABOVE the first node (a stub joined to nothing) and skipped
                  the last row's segment entirely (a 9.5px gap before the final
                  node). So the first row is clamped to start at its node and
                  the last to stop at its. */}
              <div
                aria-hidden="true"
                style={{ position: "relative", width: "9px", alignSelf: "stretch", flexShrink: 0 }}
              >
                {hasRail && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        left: "4px",
                        width: "1px",
                        backgroundColor: "var(--mem-border)",
                        ...railSpan,
                      }}
                    />
                    {/* Indeterminate, not fake: a travelling glint for work in
                        flight, a solid top-down ink once it lands. */}
                    {status === "running" && (
                      <div
                        className="mem-rail-flow"
                        style={{ position: "absolute", left: "4px", width: "1px", ...railSpan }}
                      />
                    )}
                    <div
                      className={isDone ? "mem-rail-ink" : undefined}
                      style={{
                        position: "absolute",
                        left: "4px",
                        width: "1px",
                        transformOrigin: "top",
                        transform: isDone ? undefined : "scaleY(0)",
                        backgroundColor: "var(--mem-accent-sage)",
                        ...railSpan,
                      }}
                    />
                  </>
                )}
                <div
                  className={status === "running" ? "mem-node-pulse" : undefined}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "5px",
                    width: "9px",
                    height: "9px",
                    borderRadius: "var(--mem-radius-full)",
                    border: `1.5px solid ${NODE_RING_COLOR[status]}`,
                    backgroundColor: isDone ? "var(--mem-accent-sage)" : "transparent",
                  }}
                />
              </div>

              <div
                className="min-w-0 flex-1"
                style={{ paddingBottom: isLast ? 0 : "var(--mem-space-5)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      style={{
                        fontFamily: "var(--mem-font-body)",
                        fontSize: "var(--mem-text-base)",
                        fontWeight: 500,
                        color: isDone ? "var(--mem-text)" : "var(--mem-text-secondary)",
                        transition: "color var(--mem-dur-fast) ease",
                      }}
                    >
                      {labelOf(row)}
                    </p>
                    {/* Prose, not data — these are sentences. Mono is reserved
                        for the machine-state column on the right. */}
                    <p
                      id={row.kind === "model" ? modelProgressDescId(row.id) : undefined}
                      style={{
                        fontFamily: "var(--mem-font-body)",
                        fontSize: "var(--mem-text-sm)",
                        color: "var(--mem-text-tertiary)",
                        lineHeight: "1.5",
                        marginTop: "2px",
                      }}
                    >
                      {subOf(row)}
                    </p>
                    {/* Only once we have a real numerator AND an estimated
                        total (both gated above) — never a bar with nothing
                        behind it. Bytes-unavailable falls back to exactly
                        today's indeterminate rail glint further left, not to
                        a bar stuck at 0%. */}
                    {row.kind === "model" &&
                      modelDownloading &&
                      downloadProgressFraction != null && (
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(downloadProgressFraction * 100)}
                          aria-valuetext={subOf(row)}
                          aria-describedby={modelProgressDescId(row.id)}
                          style={{
                            marginTop: "8px",
                            height: "4px",
                            borderRadius: "var(--mem-radius-full)",
                            backgroundColor: "var(--mem-border)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            aria-hidden="true"
                            style={{
                              height: "100%",
                              width: `${downloadProgressFraction * 100}%`,
                              borderRadius: "var(--mem-radius-full)",
                              backgroundColor: "var(--mem-accent-sage)",
                              transition: "width var(--mem-dur-fast) ease",
                            }}
                          />
                        </div>
                      )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      data-testid={`task-status-${row.id}`}
                      aria-describedby={error ? taskRowDescId(row.id) : undefined}
                      style={{
                        fontFamily: "var(--mem-font-mono)",
                        fontSize: "var(--mem-text-sm)",
                        color: STATUS_COLOR[status],
                        whiteSpace: "nowrap",
                      }}
                    >
                      {statusTextOf(row)}
                    </span>
                    {canRetry && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => runRow(row)}
                        data-testid={`task-retry-${row.id}`}
                      >
                        {t("setup.settingUp.retry")}
                      </Button>
                    )}
                  </div>
                </div>

                {error && (
                  <p
                    id={taskRowDescId(row.id)}
                    role="alert"
                    style={{
                      fontFamily: "var(--mem-font-body)",
                      fontSize: "var(--mem-text-sm)",
                      color: "var(--mem-status-danger-text)",
                      lineHeight: "1.5",
                      marginTop: "8px",
                    }}
                  >
                    {error}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The handoff. Not a rail row: the rail is work Wenlan does, and this is
          the one thing it can't — it needs the user to go use an agent. Sitting
          below the spine, in the imperative, it reads as "what's next" instead
          of a task stuck at incomplete. It still carries the strongest proof in
          the wizard: a write that landed AFTER setup, from a real agent. */}
      <div
        data-testid="first-write-handoff"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--mem-space-3)",
          paddingTop: "var(--mem-space-4)",
          borderTop: "1px solid var(--mem-border)",
        }}
      >
        <div
          aria-hidden="true"
          className={waitingDone ? undefined : "mem-node-pulse"}
          style={{
            marginTop: "5px",
            width: "9px",
            height: "9px",
            flexShrink: 0,
            borderRadius: "var(--mem-radius-full)",
            border: `1.5px solid ${waitingDone ? "var(--mem-accent-sage)" : "var(--mem-accent-indigo)"}`,
            backgroundColor: waitingDone ? "var(--mem-accent-sage)" : "transparent",
          }}
        />
        <div className="min-w-0">
          <p
            data-testid="first-write-label"
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "var(--mem-text-base)",
              fontWeight: 500,
              color: waitingDone ? "var(--mem-text)" : "var(--mem-text-secondary)",
              transition: "color var(--mem-dur-fast) ease",
            }}
          >
            {waitingDone
              ? t("setup.settingUp.firstWriteDoneLabel", {
                  agent: freshAgents[0]?.name ?? "",
                })
              : t("setup.settingUp.firstWriteLabel")}
          </p>
          <p
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "var(--mem-text-sm)",
              color: "var(--mem-text-tertiary)",
              lineHeight: "1.5",
              marginTop: "2px",
            }}
          >
            {waitingDone
              ? t("setup.settingUp.firstWriteDoneSub")
              : t("setup.settingUp.firstWriteSub")}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {/* Nothing on this step is a gate — Continue was always live. It just
            never said so, so a model download made the screen feel like a wait.
            The daemon keeps downloading and ingesting after the wizard closes. */}
        {anyRunning && (
          <p
            data-testid="setting-up-walk-away"
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "var(--mem-text-sm)",
              color: "var(--mem-text-tertiary)",
              lineHeight: "1.5",
            }}
          >
            {t("setup.settingUp.walkAwayNote")}
          </p>
        )}
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-sm)",
            color: "var(--mem-text-tertiary)",
            lineHeight: "1.5",
          }}
        >
          {t("setup.settingUp.configuredNote")}
        </p>
        {anyFailed && (
          <p
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "var(--mem-text-sm)",
              color: "var(--mem-text-tertiary)",
              lineHeight: "1.5",
            }}
          >
            {t("setup.settingUp.failedHint")}
          </p>
        )}
      </div>
    </div>
    </StepShell>
  );
}

/** Small two-line stat cell used inside the Done step's import card. Paired
 *  with another to form a "Topics · Connections" row. Kept local to keep
 *  the Done variant self-contained. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col flex-1 items-start"
      style={{ gap: "2px" }}
    >
      <span
        style={{
          fontFamily: "var(--mem-font-heading)",
          fontSize: "var(--mem-text-xl)",
          fontWeight: 500,
          color: "var(--mem-text)",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--mem-font-mono)",
          fontSize: "10px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--mem-text-tertiary)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Done Step ───────────────────────────────────────────────────────────

// Defect 4: raw canonical agent ids (e.g. two ids that both mean "Codex")
// must never render. Every entry is resolved through resolveAgentDisplayName
// and deduped by resolved display name; the list is capped so the row never
// runs unbounded.
const MAX_AGENT_CHIPS = 6;

function DoneStep({
  importResult,
  connectedAgents,
  onComplete,
  hideDots,
}: {
  importResult: ImportResult | null;
  connectedAgents: string[];
  onComplete: () => void;
  hideDots: boolean;
}) {
  const { t } = useTranslation();
  const { data: agentConnections } = useQuery({ queryKey: ["agents"], queryFn: listAgents });
  const hasImportData = importResult && importResult.imported > 0;
  const hasConnectedAgents = connectedAgents.length > 0;
  const isSkipPath = !hasImportData && !hasConnectedAgents;
  const breakdownEntries = hasImportData
    ? Object.entries(importResult.breakdown).filter(([, count]) => count > 0)
    : [];
  const kgTotal = hasImportData
    ? importResult.entities_created +
      importResult.observations_added +
      importResult.relations_created
    : 0;

  const resolvedAgentNames = useMemo(() => {
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const rawId of connectedAgents) {
      const displayName = resolveAgentDisplayName(rawId, agentConnections);
      if (!seen.has(displayName)) {
        seen.add(displayName);
        resolved.push(displayName);
      }
    }
    return resolved;
  }, [connectedAgents, agentConnections]);
  const visibleAgentNames = resolvedAgentNames.slice(0, MAX_AGENT_CHIPS);
  const overflowAgentCount = resolvedAgentNames.length - visibleAgentNames.length;

  if (isSkipPath) {
    return (
      <StepShell
        hideDots={hideDots}
        activeStep="done"
        primaryAction={{ label: t("setup.done.openWenlan"), onClick: onComplete }}
      >
      <div
        className="flex flex-col items-center text-center"
        style={{ gap: "28px", paddingTop: "32px" }}
      >
        <h1
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "var(--mem-text-2xl)",
            fontWeight: 500,
            color: "var(--mem-text)",
          }}
        >
          {t("setup.done.readyTitle")}
        </h1>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "14px",
            color: "var(--mem-text-secondary)",
            lineHeight: 1.6,
          }}
        >
          {t("setup.done.readyBody1")}
        </p>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "14px",
            color: "var(--mem-text-secondary)",
            lineHeight: 1.6,
          }}
        >
          {t("setup.done.readyBody2")}
        </p>
      </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      hideDots={hideDots}
      activeStep="done"
      primaryAction={{ label: t("setup.getStarted"), onClick: onComplete }}
    >
    <div
      className="flex flex-col items-center text-center"
      style={{ gap: "28px", paddingTop: "32px" }}
    >
      {/* Success icon */}
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          backgroundColor: "var(--mem-status-success-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--mem-status-success-text)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      {/* Beefed Done copy: headline + two prose lines */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--mem-font-heading)",
            fontSize: "var(--mem-text-2xl)",
            fontWeight: 500,
            color: "var(--mem-text)",
            margin: 0,
          }}
        >
          {t("setup.done.allSetTitle")}
        </p>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "14px",
            color: "var(--mem-text-secondary)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {t("setup.done.allSetBody1")}
        </p>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "14px",
            color: "var(--mem-text-secondary)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {t("setup.done.allSetBody2")}
        </p>
      </div>

      {/* Import stats card — surfaces the essential value Wenlan extracted:
          memories in, topics (entities) pulled out, and a forward line about
          pages that will distill as the refinery runs. We rename
          "entities" → "topics" at the UI layer because that's the word end
          users think in; the data model keeps its canonical name. */}
      {hasImportData && (
        <div
          className="rounded-xl px-5 py-4 w-full text-left"
          style={{
            backgroundColor: "var(--mem-surface)",
            border: "1px solid var(--mem-border)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--mem-text)",
                margin: 0,
              }}
            >
              {t("setup.done.memoriesImported", { count: importResult.imported })}
            </p>

            {/* Type breakdown badges */}
            {breakdownEntries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {breakdownEntries.map(([type, count]) => (
                  <Tag key={type} tone="neutral">
                    {type}
                    <span style={{ opacity: 0.7, marginLeft: "4px" }}>{count}</span>
                  </Tag>
                ))}
              </div>
            )}
          </div>

          {/* Topics + connections — elevated from mono afterthought to a
              proper two-stat row. This is the knowledge graph surfacing
              into the onboarding: every topic is a potential anchor for a
              page. */}
          {kgTotal > 0 && (
            <div
              className="flex items-stretch"
              style={{
                borderTop: "1px solid var(--mem-border)",
                paddingTop: "12px",
                gap: "20px",
              }}
            >
              <Stat
                label={t("setup.done.topics")}
                value={importResult.entities_created}
              />
              <div style={{ width: "1px", backgroundColor: "var(--mem-border)" }} />
              <Stat
                label={t("setup.done.connections")}
                value={
                  importResult.observations_added +
                  importResult.relations_created
                }
              />
            </div>
          )}

          {/* Potential-pages expectation. Honest (no fabricated number):
              just the promise that distillation is next. */}
          <p
            style={{
              fontFamily: "var(--mem-font-body)",
              fontStyle: "italic",
              fontSize: "12.5px",
              color: "var(--mem-text-tertiary)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {t("setup.done.pagesWillDistill")}
          </p>
        </div>
      )}

      {/* Connected agents */}
      {visibleAgentNames.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-center gap-2"
          style={{ marginTop: "-8px" }}
        >
          <span
            style={{
              fontFamily: "var(--mem-font-body)",
              fontSize: "13px",
              color: "var(--mem-text-secondary)",
            }}
          >
            {t("setup.done.connected")}
          </span>
          {visibleAgentNames.map((name) => (
            <Tag key={name} tone="accent">
              {name}
            </Tag>
          ))}
          {overflowAgentCount > 0 && (
            <Tag tone="neutral">
              {t("setup.done.moreAgents", { count: overflowAgentCount })}
            </Tag>
          )}
        </div>
      )}
    </div>
    </StepShell>
  );
}

// ── SetupWizard ─────────────────────────────────────────────────────────

export function SetupWizard({
  onComplete,
  initialStep,
  initialPendingModelId = null,
  initialPendingImportPick = null,
}: SetupWizardProps) {
  const startStep = initialStep ?? "welcome";
  const [step, setStep] = useState<WizardStep>(startStep);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [connectedAgents, setConnectedAgents] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<McpClient[]>([]);
  const [pendingModelId, setPendingModelId] = useState<string | null>(initialPendingModelId);
  const [pendingImportPick, setPendingImportPick] = useState<VaultPick | null>(initialPendingImportPick);
  const [, setImportPhase] = useState<string>("input");
  const wizardEnteredAtRef = useRef<number>(Math.floor(Date.now() / 1000));
  // Step dots hide when entering at a specific step (unchanged semantics).
  const hideDots = !!initialStep;

  // Stable identity, and bails out when nothing new arrived. ConnectStep's
  // already-configured effect lists `onConnected` in its deps, so a fresh
  // closure or a fresh array on every call would feed itself: notify → setState
  // → re-render → new callback → effect re-fires → notify.
  const handleConnectedAgents = useCallback((agents: string[]) => {
    setConnectedAgents((prev) => {
      const merged = new Set([...prev, ...agents]);
      return merged.size === prev.length ? prev : Array.from(merged);
    });
  }, []);

  if (step === "welcome") {
    return <WelcomeStep hideDots={hideDots} onNext={() => setStep("intelligence-choice")} />;
  }

  if (step === "intelligence-choice") {
    return (
      <IntelligenceChoiceStep
        hideDots={hideDots}
        onBack={() => setStep("welcome")}
        onNext={(deviceModelId) => {
          setPendingModelId(deviceModelId);
          setStep("import");
        }}
      />
    );
  }

  if (step === "import") {
    return (
      <ImportStep
        hideDots={hideDots}
        onBack={() => setStep("intelligence-choice")}
        importHint={(
          <Trans
            i18nKey="setup.import.laterHint"
            components={{ strong: <strong /> }}
          />
        )}
        onPhaseChange={setImportPhase}
        onAdvance={(pick) => {
          setPendingImportPick(pick);
          setStep("connect");
        }}
        onComplete={(_source, result) => {
          setImportResult(result);
          setStep("connect");
        }}
      />
    );
  }

  if (step === "connect") {
    return (
      <ConnectStep
        hideDots={hideDots}
        onNext={(selected) => {
          setSelectedClients(selected);
          setStep("setting-up");
        }}
        onBack={startStep === "connect" ? onComplete : () => setStep("import")}
        onConnected={handleConnectedAgents}
      />
    );
  }

  if (step === "setting-up") {
    return (
      <SettingUpStep
        hideDots={hideDots}
        selected={selectedClients}
        pendingModelId={pendingModelId}
        pendingImportPick={pendingImportPick}
        onNext={() => setStep("done")}
        onBack={() => setStep("connect")}
        onConnected={handleConnectedAgents}
        wizardEnteredAt={wizardEnteredAtRef.current}
      />
    );
  }

  return (
    <DoneStep
      hideDots={hideDots}
      importResult={importResult}
      connectedAgents={connectedAgents}
      onComplete={onComplete}
    />
  );
}

export default SetupWizard;
