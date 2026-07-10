// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from "react-i18next";
import { ApiKeyCard, OnDeviceModelCard, useApiKeyStatus } from "../intelligence/IntelligenceSetup";
import DiagnosticsSection from "./settings/DiagnosticsSection";
import GeneralSection from "./settings/sections/GeneralSection";
import CaptureSection from "./settings/sections/CaptureSection";
import SourcesSection from "./settings/sections/SourcesSection";
import AgentsSection from "./settings/sections/AgentsSection";
import { SectionHeader } from "./settings/primitives";

// ── Main component ─────────────────────────────────────────────────────

import type { SettingsSection } from "./settings/SettingsSidebar";
import { SETTINGS_GROUPS } from "./settings/SettingsSidebar";

interface SettingsPageProps {
  /** Which group to display. Driven by the Settings sidebar in Main.tsx. */
  section?: SettingsSection;
  onBack: () => void;
  onSetupAgent?: () => void;
  onImport?: () => void;
}

export default function SettingsPage({
  section = "general",
  onBack,
  onSetupAgent,
  onImport,
}: SettingsPageProps) {
  const { t } = useTranslation();

  // Filters removed — legacy ambient capture, hidden from UI

  // (old `sections` array deleted — replaced by the SettingsSidebar driving
  // a single active group via the `section` prop.)

  const activeGroup = SETTINGS_GROUPS.find((g) => g.id === section);

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto py-4">
      {/* Back + Heading. The heading now names the active group; the sidebar
          handles navigating between groups. */}
      <div>
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-md transition-colors duration-150 hover:bg-[var(--mem-hover)]" style={{ color: "var(--mem-text-tertiary)", background: "none", border: "none", cursor: "pointer", lineHeight: 0, marginBottom: "12px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <h1 style={{ fontFamily: "var(--mem-font-heading)", fontSize: "20px", fontWeight: 500, color: "var(--mem-text)" }}>
          {activeGroup ? t(activeGroup.labelKey) : t("settings.title")}
        </h1>
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "13px", color: "var(--mem-text-secondary)", marginTop: "4px" }}>
          {activeGroup ? t(activeGroup.hintKey) : t("settings.manageHint")}
        </p>
      </div>

      {/* ── Appearance ───────────────────────────────────────────── */}
      {/* ── General ─────────────────────────────────────────────── */}
      {section === "general" && <GeneralSection />}

      {/* ── Capture ─────────────────────────────────────────────── */}
      {section === "capture" && <CaptureSection />}

      {/* ── Sources (group: sources) ────────────────────────────── */}
      {section === "sources" && <SourcesSection onImport={onImport} />}

      {/* ── Agents (group: agents) ─────────────────────────────── */}
      {section === "agents" && <AgentsSection onSetupAgent={onSetupAgent} />}

      {/* ── Intelligence (group: intelligence) ──────────────────── */}
      {section === "intelligence" && (
      <IntelligenceSection delay={0} />
      )}

      {/* Diagnostics (group: diagnostics) */}
      {section === "diagnostics" && <DiagnosticsSection />}

      {/* Filters section hidden — legacy ambient capture, not relevant with memory-layer pivot */}

      {/* ── Privacy note — persistent footer on all groups. The settings
          sidebar also carries a shorter version in its bottom strip; this
          longer one stays here for users who prefer reading it inline. */}
      <div
        className="flex items-start gap-2.5 px-2 pt-2 mem-fade-up"
        style={{ animationDelay: "120ms" }}
      >
        <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--mem-text-tertiary)", opacity: 0.6 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)", opacity: 0.6, lineHeight: "1.5" }}>
          {t("settings.footer")}
        </p>
      </div>

    </div>
  );
}

function IntelligenceSection({ delay }: { delay: number }) {
  const { t } = useTranslation();
  const { isConfigured } = useApiKeyStatus();

  return (
    <section className="mem-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <SectionHeader
        label={t("settings.groups.intelligence.label")}
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        }
      />
      <div className="flex flex-col gap-3">
        <ApiKeyCard />
        {!isConfigured && (
          <div className="mem-fade-up" style={{ animationDelay: `${delay + 30}ms` }}>
            <OnDeviceModelCard />
          </div>
        )}
      </div>
    </section>
  );
}
