// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listEntities, getProfile } from "../../lib/tauri";
import ProfileAvatar from "./ProfileAvatar";

interface IdentityCardProps {
  onOpenDetail: (entityId: string) => void;
}

export default function IdentityCard({ onOpenDetail }: IdentityCardProps) {
  const { t } = useTranslation();

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: getProfile,
  });

  const { data: entities = [] } = useQuery({
    queryKey: ["entities", "person"],
    queryFn: () => listEntities("person"),
    refetchInterval: 10000,
  });

  const selfEntity = entities[0];
  // Profile name is canonical — entity name may be partial (e.g. "Lu" vs "Qi-Xuan Lu")
  const displayName = profile?.display_name || profile?.name || selfEntity?.name || "";

  if (!selfEntity) {
    return (
      <button
        onClick={() => onOpenDetail("__create_profile__")}
        className="w-full rounded-xl p-5 text-center text-left transition-all duration-200 hover:shadow-md"
        style={{
          border: "2px dashed var(--mem-border)",
        }}
      >
        <div
          className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
          style={{ backgroundColor: "var(--mem-border)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--mem-text-tertiary)" }}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <p
          style={{
            fontFamily: "var(--mem-font-body)",
            fontSize: "12px",
            color: "var(--mem-text-tertiary)",
            lineHeight: "1.5",
          }}
        >
          {t("identityCard.setupProfile")}
        </p>
      </button>
    );
  }

  return (
    <button
      onClick={() => onOpenDetail("__create_profile__")}
      className="w-full rounded-xl p-5 text-left transition-all duration-200 hover:shadow-md"
      style={{
        backgroundColor: "var(--mem-surface)",
        border: "1px solid var(--mem-border)",
      }}
    >
      <ProfileAvatar
        avatarPath={profile?.avatar_path}
        displayName={displayName}
        size={56}
        fontSize={20}
        className="mx-auto mb-3"
      />

      <p
        className="text-center font-medium"
        style={{
          fontFamily: "var(--mem-font-heading)",
          fontSize: "18px",
          color: "var(--mem-text)",
        }}
      >
        {displayName}
      </p>

    </button>
  );
}
