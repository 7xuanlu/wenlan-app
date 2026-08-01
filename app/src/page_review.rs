// SPDX-License-Identifier: AGPL-3.0-only
//! The page-review command — the only Tauri command that carries a UI-presence
//! capability.
//!
//! Binding spec: `docs/plans/2026-07-27-m5-presence-threat-model.md` in the
//! `wenlan` daemon repo. Its most load-bearing step is §3.3: **the Tauri
//! backend submits the mutation itself**, so frontend JavaScript never receives
//! a capability. That is why minting and submitting are one command here rather
//! than a `mint` command whose result a second command posts — the intermediate
//! value in that design is a capability sitting in JavaScript, which is a
//! capability sitting anywhere JavaScript reaches (T1).
//!
//! What crosses into JavaScript, in both directions:
//!
//! - in: a page ID and the content the detail view rendered;
//! - out: [`crate::api::PageReviewOutcome`], which carries a version number and
//!   a variant name and nothing else.
//!
//! This module is kept separate from `search.rs`, where the other page commands
//! live, for the same reason the daemon keeps `db/presence_review.rs` separate
//! from its other page routes: the ordering and binding rules only make sense
//! read together, and they are easy to weaken one edit at a time when they are
//! spread through a large file.

use std::sync::Arc;

use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

use crate::api::PageReviewOutcome;
use crate::state::AppState;

type State = Arc<RwLock<AppState>>;

/// SHA-256 over the **exact bytes** of a page's content, lowercase hex.
///
/// A byte-for-byte mirror of `wenlan_core::provenance::revision_content_digest`,
/// which is what the daemon computes over the `content` column before deciding
/// whether the capability still binds (T6). The daemon's other digest,
/// `canonical_content_digest`, is whitespace-tolerant and answers a different
/// question — "is this the same content?" rather than "is this the exact text
/// the human was looking at?" — and swapping the two here would make a reflow
/// invisible to a check whose entire job is to notice one.
fn content_digest(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The idempotency key for reviewing one page at one exact content.
///
/// Derived rather than random, which is what makes a retry a retry. The daemon
/// looks a repeated `(caller_id, operation_id)` up before it validates
/// anything (§4), and answers with the stored receipt — so a review whose
/// response was dropped in transit succeeds again on the next click instead of
/// failing as a spent nonce. A fresh random ID each time would make every
/// retry a new mutation and put the replay path permanently out of reach.
///
/// Including the digest is what keeps distinct reviews distinct: once the page
/// changes, reviewing it is a different operation, and reusing the earlier ID
/// for it would be the operation-ID collision of T8.
fn operation_id(page_id: &str, base_digest: &str) -> String {
    format!("review:{page_id}:{base_digest}")
}

/// Marks one page human-reviewed, binding the mark to the exact text the human
/// had in front of them.
///
/// `content` is the body the detail view rendered, not a digest computed in
/// JavaScript and not something re-fetched here. Re-fetching would be the
/// quiet defect in this whole path: it would approve whatever the page says
/// *now*, which is precisely the content nobody looked at, and T6 exists to
/// refuse exactly that.
#[tauri::command]
pub async fn review_page(
    state: tauri::State<'_, State>,
    page_id: String,
    content: String,
) -> Result<PageReviewOutcome, String> {
    let client = state.read().await.client.clone();
    let base_digest = content_digest(&content);
    let operation_id = operation_id(&page_id, &base_digest);

    let body = match crate::presence::mint_page_review(&page_id, &base_digest, &operation_id) {
        Ok(body) => body,
        // The reason names a path on disk. It belongs in the log, where an
        // operator can act on it, and not in a UI string — the daemon's own
        // refusals are deliberately coarse for the same reason, and answering
        // more precisely from this side would undo that.
        Err(crate::presence::PresenceError::SecretUnavailable(reason)) => {
            log::warn!("[presence] cannot mint a review capability: {reason}");
            return Ok(PageReviewOutcome::Unavailable);
        }
    };

    client.review_page(&page_id, &body).await
}

/// Whether this daemon's M5 truth cutover is live.
///
/// `false` covers a daemon that predates the field, one still at generation 0,
/// and one that could not read its own generation. `human_reviewed` means
/// nothing before the cutover, so offering the action there would be offering
/// a gesture with no effect anybody could observe.
#[tauri::command]
pub async fn page_review_supported(state: tauri::State<'_, State>) -> Result<bool, String> {
    let client = state.read().await.client.clone();
    Ok(client.truth_status().await?.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_content_digest_is_the_one_the_daemon_computes() {
        // Pinned against the published SHA-256 of "hello" rather than against
        // this module's own output, so a change of algorithm cannot rewrite
        // its own expectation. The daemon hashes the `content` column with
        // plain SHA-256 over its exact bytes; if these two ever disagree,
        // every review returns `presence_conflict` and nothing says why.
        assert_eq!(
            content_digest("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );
    }

    #[test]
    fn the_content_digest_notices_whitespace() {
        // The whole point of binding to `revision_content_digest` rather than
        // the canonical one. A reflow changes every line boundary, so a
        // whitespace-tolerant digest would let a human's approval carry over
        // to text they never read.
        assert_ne!(content_digest("a b"), content_digest("a  b"));
        assert_ne!(content_digest("a"), content_digest("a\n"));
    }

    #[test]
    fn one_page_at_one_content_always_gets_the_same_operation_id() {
        // What makes a dropped response recoverable: the retry hits the
        // daemon's receipt lookup instead of minting a second mutation.
        assert_eq!(
            operation_id("p1", &content_digest("body")),
            operation_id("p1", &content_digest("body")),
        );
    }

    #[test]
    fn editing_the_page_makes_reviewing_it_a_different_operation() {
        assert_ne!(
            operation_id("p1", &content_digest("body")),
            operation_id("p1", &content_digest("body edited")),
        );
        assert_ne!(
            operation_id("p1", &content_digest("body")),
            operation_id("p2", &content_digest("body")),
        );
    }
}
