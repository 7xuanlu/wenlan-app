// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { confirmEntity, deleteEntity, getEntityDetail } from "../../lib/tauri";
import { EntityConnections } from "./entity-detail/EntityConnections";
import { EntityContextRail } from "./entity-detail/EntityContextRail";
import "./entity-detail/EntityDetail.css";
import {
  entityMonogram,
  formatAbsoluteTimestamp,
  formatRelativeEntityTime,
} from "./entity-detail/formatEntityMetadata";
import { EntityObservations } from "./entity-detail/EntityObservations";

interface EntityDetailProps {
  entityId: string;
  onBack: () => void;
  onEntityClick: (entityId: string) => void;
  onMemoryClick?: (sourceId: string) => void;
}

export default function EntityDetail({
  entityId,
  onBack,
  onEntityClick,
  onMemoryClick,
}: EntityDetailProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { data: detail, isError, refetch } = useQuery({
    queryKey: ["entityDetail", entityId],
    queryFn: () => getEntityDetail(entityId),
    refetchInterval: 5_000,
  });
  const invalidateEntityDetail = () => {
    queryClient.invalidateQueries({ queryKey: ["entityDetail", entityId] });
    queryClient.invalidateQueries({ queryKey: ["entities"] });
  };
  const confirmMutation = useMutation({
    mutationFn: (confirmed: boolean) => confirmEntity(entityId, confirmed),
    onSuccess: invalidateEntityDetail,
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteEntity(entityId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["entityDetail", entityId] });
      queryClient.removeQueries({ queryKey: ["entity-linked-memories", entityId] });
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["space-entities"] });
      queryClient.invalidateQueries({ queryKey: ["constellation-entities"] });
      queryClient.invalidateQueries({ queryKey: ["constellation-relations"] });
      queryClient.invalidateQueries({ queryKey: ["connections-entities"] });
      queryClient.invalidateQueries({ queryKey: ["searchEntities"] });
      onBack();
    },
  });

  if (!detail) {
    return (
      <div className="page-detail entity-detail-dossier" aria-label={t("entityDetail.dossierLabel")}>
        <header className="entity-dossier-header">
          <BackButton onBack={onBack} label={t("entityDetail.back")} />
        </header>
        <div className="entity-detail-status" role="status">
          {isError ? (
            <>
              <p className="entity-empty">{t("entityDetail.loadError")}</p>
              <button
                type="button"
                className="memory-detail-text-button"
                onClick={() => refetch()}
              >
                {t("entityDetail.retry")}
              </button>
            </>
          ) : (
            <p className="entity-empty">{t("entityDetail.loading")}</p>
          )}
        </div>
      </div>
    );
  }

  const { entity, observations, relations } = detail;
  const space = entity.space ?? entity.domain;
  const relativeTime = formatRelativeEntityTime(entity.updated_at, locale);
  const absoluteTime = formatAbsoluteTimestamp(entity.updated_at);
  const dateline = [entity.entity_type, space, relativeTime].filter(Boolean).join(" · ");

  return (
    <div className="page-detail entity-detail-dossier" aria-label={t("entityDetail.dossierLabel")}>
      <header className="entity-dossier-header">
        <BackButton onBack={onBack} label={t("entityDetail.back")} />
        <div className="entity-dossier-hero">
          <div className="entity-dossier-hero-row">
            <div className="entity-detail-head">
              <div className="entity-detail-seal" aria-hidden="true">
                {entityMonogram(entity.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="page-detail-title">{entity.name}</h1>
                <p className="page-detail-dateline" title={absoluteTime ?? undefined}>
                  {dateline}
                </p>
              </div>
            </div>
            <div className="memory-detail-actions">
              {confirmMutation.isError || deleteMutation.isError ? (
                <span className="entity-error" role="alert">
                  {t("entityDetail.saveError")}
                </span>
              ) : null}
              <button
                type="button"
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate(!entity.confirmed)}
                className={`memory-detail-chip entity-status-chip ${entity.confirmed ? "success" : "warning"}`}
                title={
                  entity.confirmed
                    ? t("entityDetail.markUnconfirmed")
                    : t("entityDetail.confirmEntity")
                }
              >
                {entity.confirmed ? t("entityDetail.confirmed") : t("entityDetail.confirmEntity")}
              </button>
              {confirmDelete ? (
                <>
                  <span className="entity-delete-question">{t("entityDetail.deleteQuestion")}</span>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                    className="entity-delete-confirm"
                  >
                    {t("entityDetail.delete")}
                  </button>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirmDelete(false)}
                    className="memory-detail-text-button"
                  >
                    {t("entityDetail.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="memory-detail-icon-button memory-detail-delete"
                  aria-label={t("entityDetail.deleteEntity")}
                  title={t("entityDetail.deleteEntity")}
                >
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
      <div className="page-detail-grid">
        <section className="page-detail-prose entity-detail-reading" aria-label={t("entityDetail.readingLabel")}>
          <EntityConnections
            name={entity.name}
            relations={relations}
            onEntityClick={onEntityClick}
          />
          <EntityObservations
            entityId={entityId}
            entityName={entity.name}
            observations={observations}
            onInvalidate={invalidateEntityDetail}
          />
        </section>
        <EntityContextRail entity={entity} locale={locale} onMemoryClick={onMemoryClick} />
      </div>
    </div>
  );
}

function BackButton({ onBack, label }: { readonly onBack: () => void; readonly label: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="memory-detail-back"
      aria-label={label}
      title={label}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
