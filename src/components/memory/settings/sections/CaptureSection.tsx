// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getClipboardEnabled,
  setClipboardEnabled,
  getScreenCaptureEnabled,
  setScreenCaptureEnabled,
  checkScreenPermission,
  requestScreenPermission,
  getCaptureStats,
} from "../../../../lib/tauri";
import { SectionHeader, SettingRow, Toggle } from "../primitives";

export default function CaptureSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── Source toggles ─────────────────────────────────────────────────
  const { data: clipboardEnabled = true } = useQuery({
    queryKey: ["clipboardEnabled"],
    queryFn: getClipboardEnabled,
  });

  const clipboardToggleMutation = useMutation({
    mutationFn: setClipboardEnabled,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clipboardEnabled"] }),
  });

  // ── Screen capture ─────────────────────────────────────────────────
  const { data: screenCaptureEnabled = false } = useQuery({
    queryKey: ["screenCaptureEnabled"],
    queryFn: getScreenCaptureEnabled,
  });

  const screenCaptureMutation = useMutation({
    mutationFn: setScreenCaptureEnabled,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["screenCaptureEnabled"] }),
  });

  const { data: screenPermission = false, refetch: refetchPermission } = useQuery({
    queryKey: ["screenPermission"],
    queryFn: checkScreenPermission,
    refetchInterval: 5000, // re-check after user grants in System Settings
  });

  const { data: captureStats } = useQuery({
    queryKey: ["captureStats"],
    queryFn: getCaptureStats,
    refetchInterval: 5000,
  });

  return (
    <section className="mem-fade-up" style={{ animationDelay: "0ms" }}>
      <SectionHeader
        label={t("settings.capture.label")}
        icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
      />
      <div className="bg-[var(--mem-surface)] rounded-xl overflow-hidden border border-[var(--mem-border)]">
        {/* Clipboard Capture */}
        <SettingRow
          title={t("settings.capture.clipboardTitle")}
          description={t("settings.capture.clipboardDescription")}
          enabled={clipboardEnabled}
          onToggle={() => clipboardToggleMutation.mutate(!clipboardEnabled)}
          statusLine={
            captureStats && captureStats.clipboard > 0 ? (
              <span style={{ fontFamily: "var(--mem-font-mono)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
                {t("settings.capture.itemsCaptured", { count: captureStats.clipboard })}
              </span>
            ) : null
          }
        />

        <div className="mx-5 border-t border-[var(--mem-border)]" style={{ opacity: 0.4 }} />

        {/* Screen Capture */}
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div style={{ fontFamily: "var(--mem-font-body)", fontSize: "14px", fontWeight: 500, color: "var(--mem-text)" }}>
                {t("settings.capture.screenTitle")}
              </div>
              <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "12px", color: "var(--mem-text-secondary)", marginTop: "2px", lineHeight: "1.5" }}>
                {t("settings.capture.screenDescription")}
              </p>
            </div>
            <div className="mt-0.5">
              <Toggle
                enabled={screenCaptureEnabled}
                onToggle={() => {
                  const next = !screenCaptureEnabled;
                  if (next && !screenPermission) {
                    // Request permission first, then enable
                    (async () => {
                      await requestScreenPermission();
                      setTimeout(() => refetchPermission(), 1000);
                    })();
                  }
                  screenCaptureMutation.mutate(next);
                }}
              />
            </div>
          </div>
          {/* Permission status inline */}
          <div className="flex items-center gap-2 mt-2.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: screenPermission ? "var(--mem-accent-sage)" : "#ef4444" }}
            />
            <span style={{ fontFamily: "var(--mem-font-body)", fontSize: "11px", color: "var(--mem-text-tertiary)" }}>
              {t("settings.capture.screenRecording")} {screenPermission ? t("settings.capture.granted") : t("settings.capture.notGranted")}
            </span>
            {!screenPermission && (
              <button
                onClick={async () => {
                  await requestScreenPermission();
                  setTimeout(() => refetchPermission(), 1000);
                }}
                className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                style={{
                  fontFamily: "var(--mem-font-body)",
                  background: "var(--mem-hover-strong)",
                  color: "var(--mem-text)",
                }}
              >
                {t("settings.capture.grantAccess")}
              </button>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}
