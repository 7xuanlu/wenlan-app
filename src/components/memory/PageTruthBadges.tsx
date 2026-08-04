// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { PageTruth } from "../../lib/tauri";

interface PageTruthBadgesProps {
  readonly cutoverLive: boolean;
  readonly truth?: PageTruth | null;
  /**
   * Optional layout wrapper, emitted ONLY when the badges themselves render.
   * Call sites must not wrap this component in their own always-rendered
   * spacer element: an empty wrapper with margins shifts pre-cutover layout,
   * breaking the "byte-identical before cutover" invariant (caught by the
   * spaces-navigation visual spec).
   */
  readonly wrapperClassName?: string;
  readonly wrapperStyle?: CSSProperties;
}

/**
 * Two independent M5 signals. The component deliberately renders nothing
 * until both the daemon's cutover and the page's explicit truth object exist;
 * review_status is a separate legacy curation axis and never feeds either
 * label here.
 */
export function PageTruthBadges({
  cutoverLive,
  truth,
  wrapperClassName,
  wrapperStyle,
}: PageTruthBadgesProps) {
  const { t } = useTranslation();
  if (!cutoverLive || !truth) return null;

  const supportLabel = truth.supported
    ? t("pages.overview.truth.supported")
    : t("pages.overview.truth.provisional");
  const reviewLabel = truth.human_reviewed
    ? t("pages.overview.truth.reviewed")
    : t("pages.overview.truth.unreviewed");

  const badges = (
    <>
      <span
        aria-label={`${t("pages.overview.truth.supportAxis")}: ${supportLabel}`}
        className={`wiki-page-state wiki-page-state--truth-${truth.supported ? "supported" : "provisional"}`}
        data-testid="page-truth-support"
      >
        {supportLabel}
      </span>
      <span
        aria-label={`${t("pages.overview.truth.humanReviewAxis")}: ${reviewLabel}`}
        className={`wiki-page-state wiki-page-state--${truth.human_reviewed ? "reviewed" : "unreviewed"}`}
        data-testid="page-truth-review"
      >
        {reviewLabel}
      </span>
    </>
  );

  if (wrapperClassName || wrapperStyle) {
    return (
      <span className={wrapperClassName} style={wrapperStyle}>
        {badges}
      </span>
    );
  }
  return badges;
}
