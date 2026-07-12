// SPDX-License-Identifier: AGPL-3.0-only
import { cloneElement, useId } from "react";
import { useTranslation } from "react-i18next";

export function Toggle({
  enabled,
  onToggle,
  "aria-describedby": ariaDescribedby,
}: {
  enabled: boolean;
  onToggle: () => void;
  "aria-describedby"?: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={enabled}
      aria-describedby={ariaDescribedby}
      className={`relative w-11 h-[26px] rounded-full transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--mem-focus-ring)] focus-visible:outline-offset-2 ${
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
  const rowId = useId();
  const errorId = `${rowId}-error`;
  const warningId = `${rowId}-warning`;
  const describedBy =
    [error ? errorId : null, warning ? warningId : null].filter(Boolean).join(" ") || undefined;

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
          <Toggle enabled={enabled} onToggle={onToggle} aria-describedby={describedBy} />
        </div>
      </div>
      {statusLine && <div className="mt-2">{statusLine}</div>}
      {error && (
        <p
          id={errorId}
          style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-status-danger-text)", marginTop: "8px", lineHeight: "1.5", wordBreak: "break-all" }}
        >
          {error}
        </p>
      )}
      {warning && (
        <div className="flex items-start gap-2 mt-2">
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-[var(--mem-status-warning-text)] shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p
            id={warningId}
            style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-status-warning-text)", lineHeight: "1.5" }}
          >
            {warning}
          </p>
        </div>
      )}
    </div>
  );
}

export function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <span aria-hidden="true" style={{ color: "var(--mem-text-tertiary)" }}>
        {icon}
      </span>
      <h3
        style={{
          fontFamily: "var(--mem-font-mono)",
          fontSize: "var(--mem-text-2xs)",
          fontWeight: 500,
          lineHeight: 1.2,
          letterSpacing: "0.14em",
          color: "var(--mem-text-tertiary)",
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </h3>
    </div>
  );
}

// ── Button ──────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; // default "secondary"
  size?: ButtonSize; // default "md"
  loading?: boolean; // disables; spinner overlays label; width preserved
}

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--mem-accent-indigo)] text-[var(--mem-text-on-accent)] border border-transparent hover:bg-[var(--mem-accent-indigo-hover)]",
  secondary:
    "bg-transparent text-[var(--mem-text)] border border-[var(--mem-border)] hover:bg-[var(--mem-hover)]",
  ghost:
    "bg-transparent text-[var(--mem-text-secondary)] border border-transparent hover:text-[var(--mem-text)] hover:bg-[var(--mem-hover)]",
  danger:
    "bg-[var(--mem-status-danger-bg)] text-[var(--mem-status-danger-text)] border border-[var(--mem-status-danger-border)] hover:border-[var(--mem-status-danger-text)]",
};

const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  md: "h-[32px] px-[14px] rounded-[var(--mem-radius-md)]",
  sm: "h-[26px] px-[10px] rounded-[var(--mem-radius-sm)]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  style,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[
        "relative inline-flex items-center justify-center gap-1.5 font-medium",
        "transition-[background-color,border-color,color] duration-[var(--mem-dur-fast)]",
        "focus-visible:outline-2 focus-visible:outline-[var(--mem-focus-ring)] focus-visible:outline-offset-2",
        "disabled:opacity-45 disabled:cursor-default",
        BUTTON_VARIANT_CLASS[variant],
        BUTTON_SIZE_CLASS[size],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        fontFamily: "var(--mem-font-body)",
        fontSize: size === "md" ? "var(--mem-text-base)" : "var(--mem-text-sm)",
        ...style,
      }}
    >
      <span className={loading ? "invisible" : undefined}>{children}</span>
      {loading && (
        <svg
          aria-hidden="true"
          className="absolute w-3.5 h-3.5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────

export interface CardProps {
  padding?: "rows" | "card" | "none"; // default "card"
  tone?: "default" | "warning" | "danger"; // default "default"
  interactive?: boolean; // default false
  children: React.ReactNode;
}

const CARD_TONE_BORDER: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "border-[var(--mem-border)]",
  warning: "border-[var(--mem-status-warning-border)]",
  danger: "border-[var(--mem-status-danger-border)]",
};

export function Card({
  padding = "card",
  tone = "default",
  interactive = false,
  children,
}: CardProps) {
  return (
    <div
      className={[
        "bg-[var(--mem-surface)] border rounded-[var(--mem-radius-lg)] overflow-hidden",
        CARD_TONE_BORDER[tone],
        padding === "card" ? "p-[var(--mem-space-5)]" : "",
        padding === "rows" ? "divide-y divide-[var(--mem-border)]" : "",
        interactive
          ? "cursor-pointer transition-[background-color,box-shadow] duration-[var(--mem-dur-fast)] hover:bg-[var(--mem-hover)] hover:shadow-[var(--mem-shadow-raised)]"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

// ── Field + Input ──────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  htmlFor: string;
  description?: string; // static helper, id `${htmlFor}-desc`
  error?: string; // id `${htmlFor}-error`, wins over description
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string }>; // input/select; cloned with id + aria-describedby
}

export function Field({ label, htmlFor, description, error, children }: FieldProps) {
  const descId = `${htmlFor}-desc`;
  const errorId = `${htmlFor}-error`;
  const describedBy = error ? errorId : description ? descId : undefined;

  return (
    <div className="flex flex-col">
      <label
        htmlFor={htmlFor}
        style={{
          fontFamily: "var(--mem-font-mono)",
          fontSize: "var(--mem-text-2xs)",
          fontWeight: 500,
          lineHeight: 1.2,
          letterSpacing: "0.14em",
          color: "var(--mem-text-tertiary)",
          textTransform: "uppercase" as const,
          marginBottom: "6px",
        }}
      >
        {label}
      </label>
      {cloneElement(children, { id: htmlFor, "aria-describedby": describedBy })}
      {error ? (
        <p
          id={errorId}
          role="alert"
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-xs)",
            lineHeight: 1.4,
            color: "var(--mem-status-danger-text)",
            marginTop: "4px",
          }}
        >
          {error}
        </p>
      ) : description ? (
        <p
          id={descId}
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "var(--mem-text-xs)",
            lineHeight: 1.4,
            color: "var(--mem-text-secondary)",
            marginTop: "4px",
          }}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean; // endpoints, API keys, model ids
  invalid?: boolean; // aria-invalid + danger border
}

export function Input({ mono = false, invalid = false, className, style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={[
        "h-[32px] px-[10px] py-[8px] rounded-[var(--mem-radius-md)] bg-[var(--mem-bg)] outline-none",
        "border",
        invalid ? "border-[var(--mem-status-danger-border)]" : "border-[var(--mem-border)]",
        "text-[var(--mem-text)] placeholder:text-[var(--mem-text-tertiary)]",
        "transition-[border-color] duration-[var(--mem-dur-fast)]",
        invalid ? "" : "focus-visible:border-[var(--mem-accent-indigo)]",
        "focus-visible:outline-2 focus-visible:outline-[var(--mem-focus-ring)] focus-visible:outline-offset-0",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        fontFamily: mono ? "var(--mem-font-mono)" : "var(--mem-font-body)",
        fontSize: mono ? "var(--mem-text-sm)" : "var(--mem-text-base)",
        ...style,
      }}
    />
  );
}

// ── StatusChip — the chip-never-lies API ──────────────────────────────

export type ProbeState =
  | { kind: "idle" } // never probed → muted, "not checked"
  | { kind: "probing" }
  | { kind: "up"; detail?: string } // e.g. "Ollama 0.6.2"
  | { kind: "down"; detail?: string } // e.g. "connection refused"
  | { kind: "stale" }; // input edited since last probe

export interface StatusChipProps {
  state: ProbeState; // the ONLY color input — no variant/intent/color prop exists
  label: string; // WHAT was probed (host, tool name), not what was selected
}

const STATUS_CHIP_TONE: Record<
  ProbeState["kind"],
  { dot: string; bg: string; text: string; border: string }
> = {
  up: {
    dot: "bg-[var(--mem-status-success-text)] rounded-full",
    bg: "bg-[var(--mem-status-success-bg)]",
    text: "text-[var(--mem-status-success-text)]",
    border: "border-[var(--mem-status-success-border)]",
  },
  down: {
    dot: "bg-[var(--mem-status-danger-text)] rounded-full",
    bg: "bg-[var(--mem-status-danger-bg)]",
    text: "text-[var(--mem-status-danger-text)]",
    border: "border-[var(--mem-status-danger-border)]",
  },
  probing: {
    dot: "bg-[var(--mem-text-tertiary)] rounded-full animate-pulse",
    bg: "bg-transparent",
    text: "text-[var(--mem-text-tertiary)]",
    border: "border-[var(--mem-border)]",
  },
  idle: {
    dot: "border border-[var(--mem-text-tertiary)] rounded-full",
    bg: "bg-transparent",
    text: "text-[var(--mem-text-tertiary)]",
    border: "border-[var(--mem-border)]",
  },
  stale: {
    dot: "border border-[var(--mem-text-tertiary)] rounded-full",
    bg: "bg-transparent",
    text: "text-[var(--mem-text-tertiary)]",
    border: "border-[var(--mem-border)]",
  },
};

export function StatusChip({ state, label }: StatusChipProps) {
  const { t } = useTranslation();
  const tone = STATUS_CHIP_TONE[state.kind];
  const detail =
    state.kind === "up" || state.kind === "down"
      ? state.detail
      : state.kind === "stale"
        ? t("status.notVerified")
        : undefined;

  return (
    <span
      aria-live="polite"
      className={[
        "inline-flex items-center gap-1.5 rounded-full border py-[2px] px-[8px] uppercase",
        tone.bg,
        tone.text,
        tone.border,
      ].join(" ")}
      style={{
        fontFamily: "var(--mem-font-mono)",
        fontSize: "var(--mem-text-2xs)",
        fontWeight: 500,
        lineHeight: 1.2,
        letterSpacing: "0.08em",
      }}
    >
      <span aria-hidden="true" className={`w-1.5 h-1.5 shrink-0 ${tone.dot}`} />
      <span>
        {label}
        {detail ? ` · ${detail}` : ""}
      </span>
    </span>
  );
}
