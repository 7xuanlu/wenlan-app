// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  getProfile,
  updateProfile,
  setAvatar,
  removeAvatar,
  setSetupCompleted,
  isRunAtLoginEnabled,
  setRunAtLogin,
} from "../../../../lib/tauri";
import { type Theme, useTheme } from "../../../../lib/theme";
import {
  readStoredLocalePreference,
  setLocalePreference,
  type StoredLocale,
} from "../../../../i18n";
import { Button, Card, Field, Input, SectionHeader, SettingRow } from "../primitives";
import ProfileAvatar from "../../ProfileAvatar";

type ThemeLabelKey =
  | "settings.theme.auto"
  | "settings.theme.light"
  | "settings.theme.dark";

const THEME_OPTIONS: { value: Theme; labelKey: ThemeLabelKey; icon: React.ReactNode }[] = [
  {
    value: "system",
    labelKey: "settings.theme.auto",
    icon: (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    value: "light",
    labelKey: "settings.theme.light",
    icon: (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    value: "dark",
    labelKey: "settings.theme.dark",
    icon: (
      <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    ),
  },
];

function formatProfileMonth(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(ts * 1000);
}

interface ProfileUpdateFields {
  name?: string;
  displayName?: string;
  bio?: string;
}

function ProfileSettingsBlock() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: getProfile,
  });
  const [nameDraft, setNameDraft] = useState("");

  const displayName = profile?.display_name || profile?.name || "";

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  const profileMutation = useMutation({
    mutationFn: (fields: ProfileUpdateFields) => {
      if (!profile) return Promise.resolve();
      return updateProfile(profile.id, fields.name, fields.displayName, undefined, fields.bio);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const avatarMutation = useMutation({
    mutationFn: (path: string) => setAvatar(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: removeAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  const saveName = () => {
    if (!profile) return;
    const next = nameDraft.trim();
    const current = displayName.trim();
    if (!next || next === current) {
      setNameDraft(displayName);
      return;
    }
    profileMutation.mutate({ name: next, displayName: next });
  };

  const handlePickAvatar = async () => {
    const selected = await open({
      title: t("settings.profile.choosePhoto"),
      filters: [{ name: t("settings.profile.images"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof selected === "string") {
      avatarMutation.mutate(selected);
    }
  };

  if (!profile) return null;

  return (
    <section className="mem-fade-up" style={{ animationDelay: "0ms" }}>
      <SectionHeader
        label={t("settings.profile.label")}
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 21a8 8 0 10-16 0" />
            <circle cx="12" cy="7" r="4" strokeWidth={1.5} />
          </svg>
        }
      />
      <Card padding="card">
        <div className="flex items-start gap-4">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <ProfileAvatar
              avatarPath={profile.avatar_path}
              displayName={displayName}
              size={56}
              fontSize={20}
            />
            <button
              type="button"
              onClick={handlePickAvatar}
              className="rounded-md px-2 py-1 transition-colors duration-150 hover:bg-[var(--mem-hover)]"
              style={{
                fontFamily: "var(--mem-font-body)",
                fontSize: "var(--mem-text-xs)",
                color: "var(--mem-text-secondary)",
              }}
            >
              {t("settings.profile.changePhoto")}
            </button>
            {profile.avatar_path && (
              <button
                type="button"
                onClick={() => removeAvatarMutation.mutate()}
                className="rounded-md px-2 py-1 transition-colors duration-150 hover:bg-[var(--mem-hover)]"
                style={{
                  fontFamily: "var(--mem-font-body)",
                  fontSize: "var(--mem-text-xs)",
                  color: "var(--mem-text-tertiary)",
                }}
              >
                {t("settings.profile.removePhoto")}
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <Field label={t("settings.profile.displayName")} htmlFor="profile-display-name">
              <Input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={saveName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setNameDraft(displayName);
                    event.currentTarget.blur();
                  }
                }}
                className="w-full"
              />
            </Field>

            <p
              style={{
                fontFamily: "var(--mem-font-mono)",
                fontSize: "var(--mem-text-xs)",
                color: "var(--mem-text-tertiary)",
              }}
            >
              {t("settings.profile.joined", { date: formatProfileMonth(profile.created_at) })}
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}

export default function GeneralSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [theme, setThemeValue] = useTheme();
  const [languagePreference, setLanguagePreference] = useState<StoredLocale>(
    () => readStoredLocalePreference(),
  );

  // ── Run at login ───────────────────────────────────────────────────
  const runAtLoginQuery = useQuery({
    queryKey: ["runAtLogin"],
    queryFn: isRunAtLoginEnabled,
  });
  const runAtLoginMutation = useMutation({
    mutationFn: setRunAtLogin,
    onSuccess: () => runAtLoginQuery.refetch(),
  });

  return (
    <>
      <ProfileSettingsBlock />
      <section className="mem-fade-up" style={{ animationDelay: "0ms" }}>
        <SectionHeader
          label={t("settings.general.appSection")}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>}
        />
        <Card padding="rows">
          <SettingRow
            title={t("settings.general.runAtLoginTitle")}
            description={t("settings.general.runAtLoginDescription")}
            enabled={runAtLoginQuery.data ?? false}
            onToggle={() => runAtLoginMutation.mutate(!(runAtLoginQuery.data ?? false))}
          />
        </Card>
        {/* Theme — folded into General; previously its own "Appearance" sidebar entry. */}
        <div className="mt-4">
          <Card padding="rows">
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-md)", fontWeight: 500, color: "var(--mem-text)" }}>{t("settings.theme.label")}</div>
                  <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)", marginTop: "2px", lineHeight: "1.5" }}>
                    {t("settings.theme.description")}
                  </p>
                </div>
                <div className="relative flex bg-[var(--mem-hover)] rounded-lg p-0.5 shrink-0">
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-md shadow-sm transition-transform duration-200 ease-out"
                    style={{
                      backgroundColor: "var(--mem-accent-indigo)",
                      width: `calc(${100 / THEME_OPTIONS.length}% - 2px)`,
                      transform: `translateX(calc(${THEME_OPTIONS.findIndex((o) => o.value === theme)} * (100% + ${4 / (THEME_OPTIONS.length - 1)}px)))`,
                      left: 1,
                    }}
                  />
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setThemeValue(opt.value)}
                      className={`relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors duration-200 ${
                        theme === opt.value
                          ? "text-[var(--mem-text-on-accent)]"
                          : "text-[var(--mem-text-secondary)] hover:text-[var(--mem-text)]"
                      }`}
                      style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-xs)", fontWeight: 500 }}
                    >
                      {opt.icon}
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className="mt-4">
          <Card padding="rows">
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label
                    htmlFor="settings-language"
                    style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-md)", fontWeight: 500, color: "var(--mem-text)" }}
                  >
                    {t("settings.language.label")}
                  </label>
                  <p style={{ fontFamily: "var(--mem-font-body)", fontSize: "var(--mem-text-sm)", color: "var(--mem-text-secondary)", marginTop: "2px", lineHeight: "1.5" }}>
                    {t("settings.language.description")}
                  </p>
                </div>
                <select
                  id="settings-language"
                  value={languagePreference}
                  onChange={(event) => {
                    const nextPreference = event.currentTarget.value as StoredLocale;
                    setLanguagePreference(nextPreference);
                    void setLocalePreference(nextPreference);
                  }}
                  className="rounded-lg px-3 py-1.5 shrink-0"
                  style={{
                    backgroundColor: "var(--mem-hover)",
                    border: "1px solid var(--mem-border)",
                    color: "var(--mem-text)",
                    fontFamily: "var(--mem-font-body)",
                    fontSize: "var(--mem-text-sm)",
                  }}
                >
                  <option value="system">{t("settings.language.system")}</option>
                  <option value="en">{t("settings.language.english")}</option>
                  <option value="zh-Hans">{t("settings.language.simplifiedChinese")}</option>
                  <option value="zh-Hant">{t("settings.language.traditionalChinese")}</option>
                </select>
              </div>
            </div>
          </Card>
        </div>
        {/* Re-run setup wizard. Confirmation prevents accidental restart;
            data is preserved regardless. */}
        <div className="px-2 pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="hover:underline"
            onClick={async () => {
              const ok = window.confirm(
                t("settings.general.rerunSetupConfirm")
              );
              if (!ok) return;
              await setSetupCompleted(false);
              queryClient.invalidateQueries({ queryKey: ["shouldShowWizard"] });
            }}
          >
            {t("settings.general.rerunSetup")}
          </Button>
        </div>
      </section>
    </>
  );
}
