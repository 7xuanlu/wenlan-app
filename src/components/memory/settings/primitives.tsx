// SPDX-License-Identifier: AGPL-3.0-only
export function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-11 h-[26px] rounded-full transition-colors shrink-0 ${
        enabled ? "bg-[var(--mem-accent-indigo)]" : "bg-[var(--mem-hover-strong)]"
      }`}
    >
      <span
        className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "left-[22px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

export function SettingRow({
  title,
  description,
  enabled,
  onToggle,
  statusLine,
  warning,
  error,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  statusLine?: React.ReactNode;
  warning?: string | null;
  error?: string | null;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div style={{ fontFamily: "var(--mem-font-body)", fontSize: "14px", fontWeight: 500, color: "var(--mem-text)" }}>
            {title}
          </div>
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", marginTop: "2px", lineHeight: "1.5" }}>
            {description}
          </p>
        </div>
        <div className="mt-0.5">
          <Toggle enabled={enabled} onToggle={onToggle} />
        </div>
      </div>
      {statusLine && <div className="mt-2">{statusLine}</div>}
      {error && (
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "#ef4444", marginTop: "8px", lineHeight: "1.5", wordBreak: "break-all" }}>
          {error}
        </p>
      )}
      {warning && (
        <div className="flex items-start gap-2 mt-2">
          <svg className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "#fbbf24", lineHeight: "1.5" }}>{warning}</p>
        </div>
      )}
    </div>
  );
}

export function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <span style={{ color: "var(--mem-text-tertiary)" }}>{icon}</span>
      <h3 style={{ fontFamily: "var(--mem-font-heading)", fontSize: "12px", fontWeight: 600, letterSpacing: "0.05em", color: "var(--mem-text-tertiary)", textTransform: "uppercase" as const }}>
        {label}
      </h3>
    </div>
  );
}
