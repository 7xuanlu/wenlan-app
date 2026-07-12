// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from "react-i18next";
import SourcesList from "../../sources/SourcesSection";
import { ImportFlow } from "../../../ChatImport/ImportFlow";
import { SectionHeader } from "../primitives";

export default function SourcesSection({ onImport }: { onImport?: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      {/* ── Import Memories ────────────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "0ms" }}>
        <SectionHeader
          label={t("settings.sources.importMemoriesTitle")}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>}
        />
        <div className="bg-[var(--mem-surface)] rounded-xl overflow-hidden border border-[var(--mem-border)]">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div style={{ fontFamily: "var(--mem-font-body)", fontSize: "14px", fontWeight: 500, color: "var(--mem-text)" }}>{t("settings.sources.importMemoriesTitle")}</div>
                <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", marginTop: "2px", lineHeight: "1.5" }}>
                  {t("settings.sources.importMemoriesDescription")}
                </p>
              </div>
              {onImport && (
                <button
                  onClick={onImport}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 shrink-0"
                  style={{ fontFamily: "var(--mem-font-body)", backgroundColor: "var(--mem-accent-indigo)", color: "white" }}
                >
                  {t("settings.sources.import")}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Import Chat History ──────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "60ms" }}>
        <SectionHeader
          label={t("settings.sources.importChatHistoryTitle")}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4 0v4m0-4L8 8m4-4l4 4" /></svg>}
        />
        <div className="bg-[var(--mem-surface)] rounded-xl overflow-hidden border border-[var(--mem-border)]">
          <div className="px-5 py-4">
            <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", marginBottom: "12px", lineHeight: "1.5" }}>
              {t("settings.sources.importChatHistoryDescription")}
            </p>
            <ImportFlow />
          </div>
        </div>
      </section>

      {/* ── Sources ────────────────────────────────────────────── */}
      <section className="mem-fade-up" style={{ animationDelay: "30ms" }}>
        <SectionHeader
          label={t("settings.groups.sources.label")}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>}
        />
        <SourcesList />
      </section>
    </>
  );
}
