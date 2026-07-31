// SPDX-License-Identifier: AGPL-3.0-only
//! Tauri-owned UI-presence capability minting (M5 App PR, D7).
//!
//! This is a **cooperative local-client provenance boundary**, not hostile
//! same-user isolation — Wenlan's loopback daemon is unauthenticated, and a
//! hostile process running as the same macOS user can read this module's
//! secret because it can read anything that user can read. What this module
//! makes true: a mutation carrying a valid capability came from a concrete
//! user gesture that reached this Tauri backend, an ordinary MCP/HTTP client
//! cannot mint one, and the capability never reaches JavaScript. Binding
//! spec: `docs/plans/2026-07-27-m5-presence-threat-model.md` (in the
//! `wenlan` daemon repo).
//!
//! **Minting only.** The daemon validates a capability, consumes its nonce
//! inside the mutation transaction, and writes the resulting `attests` edge
//! or `human_reviewed` flag — but as of this PR there is no daemon HTTP route
//! or wire request/response type for either mutation (checked against
//! `crates/wenlan-server/src/routes.rs` and `crates/wenlan-types/src/requests.rs`
//! on the daemon's `origin/main`; neither declares an attest/review path).
//! So this module stops at minting a correctly-bound, correctly-redacted
//! capability — there is nothing to submit it to yet, and inventing an
//! endpoint contract here would be exactly the "compatibility shortcut" the
//! frozen M5 goal prompt forbids. The `PagesOverview`/`PageDetail` actions
//! this would back stay disabled in the UI; no Tauri command calls `mint`.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::identity_paths::app_data_dir;

type HmacSha256 = Hmac<Sha256>;

const SECRET_LEN: usize = 32;
const NONCE_LEN: usize = 16;
/// D7 §3: mint time + 60s.
const CAPABILITY_TTL_SECS: u64 = 60;
/// D7 §3: "protocol version, so the format can change without ambiguity".
pub const PROTOCOL_VERSION: u32 = 1;

const SECRET_FILE_NAME: &str = "presence_secret";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresenceAction {
    AttestClaim,
    ReviewPage,
}

impl PresenceAction {
    fn as_str(self) -> &'static str {
        match self {
            PresenceAction::AttestClaim => "attest_claim",
            PresenceAction::ReviewPage => "review_page",
        }
    }
}

/// What one capability authorizes, before minting. `target_ids` and
/// `base_digest` are the exact-target/exact-version binding (D7 §3 T4, T6):
/// a capability minted against a stale page/revision digest is a capability
/// for content that no longer exists, so callers must re-mint against the
/// currently-viewed version rather than reusing an old request.
#[derive(Debug, Clone)]
pub struct PresenceRequest {
    pub action: PresenceAction,
    pub target_ids: Vec<String>,
    pub base_digest: String,
    pub caller_id: String,
    pub operation_id: String,
}

/// A minted, HMAC-signed capability.
///
/// Deliberately does **not** implement `serde::Serialize`. A `#[tauri::command]`
/// return type must implement `Serialize`, so this is a compile-time
/// guarantee that no command can hand a capability to JavaScript (T1) — the
/// alternative of implementing `Serialize` and trusting every future call
/// site to not use it is exactly the mistake the threat model calls out.
#[derive(Clone)]
pub struct PresenceCapability {
    pub action: PresenceAction,
    pub target_ids: Vec<String>,
    pub base_digest: String,
    pub caller_id: String,
    pub operation_id: String,
    pub minted_at: u64,
    pub expires_at: u64,
    pub protocol_version: u32,
    nonce: [u8; NONCE_LEN],
    mac: [u8; 32],
}

impl PresenceCapability {
    pub fn is_expired_at(&self, now: u64) -> bool {
        now >= self.expires_at
    }

    /// Safe to log, export, or return in an error (D7 §7): the nonce digest,
    /// never the nonce itself.
    pub fn nonce_digest(&self) -> String {
        hex(Sha256::digest(self.nonce))
    }
}

/// Redacted by construction: never prints `mac` or the raw nonce, only its
/// digest (D7 §7 — "never logged, exported, ... or returned in errors: the
/// HMAC, the raw capability, the install secret, the raw nonce").
impl std::fmt::Debug for PresenceCapability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PresenceCapability")
            .field("action", &self.action.as_str())
            .field("target_ids", &self.target_ids)
            .field("base_digest", &self.base_digest)
            .field("caller_id", &self.caller_id)
            .field("operation_id", &self.operation_id)
            .field("minted_at", &self.minted_at)
            .field("expires_at", &self.expires_at)
            .field("protocol_version", &self.protocol_version)
            .field("nonce_digest", &self.nonce_digest())
            .field("mac", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresenceError {
    /// The per-install secret could not be loaded or created. Presence
    /// minting is unavailable in this state — it must never degrade to
    /// trusting the caller instead (D7 §5).
    SecretUnavailable(String),
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

fn random_bytes<const N: usize>() -> Result<[u8; N], PresenceError> {
    let mut buf = [0_u8; N];
    getrandom::getrandom(&mut buf)
        .map_err(|e| PresenceError::SecretUnavailable(format!("CSPRNG unavailable: {e}")))?;
    Ok(buf)
}

#[cfg(unix)]
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    std::io::Write::write_all(&mut file, bytes)?;
    // Belt-and-braces: `mode()` only governs creation, so a pre-existing file
    // with looser permissions from an older build is tightened explicitly.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}

fn secret_path_in(dir: &Path) -> PathBuf {
    dir.join(SECRET_FILE_NAME)
}

/// Loads the per-install presence secret, generating and persisting one
/// (owner-only, `0600`, never exported or synced — a plain file under the
/// app's own data directory) on first use.
fn load_or_create_secret_in(dir: &Path) -> Result<[u8; SECRET_LEN], PresenceError> {
    let path = secret_path_in(dir);
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == SECRET_LEN {
            let mut secret = [0_u8; SECRET_LEN];
            secret.copy_from_slice(&bytes);
            return Ok(secret);
        }
        // Wrong length: treat as corrupt rather than trusting a truncated or
        // concatenated secret. Falls through to regeneration below, which
        // invalidates any outstanding capability — acceptable per D7 §5
        // (rotation needs no drain; capabilities live 60s).
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| PresenceError::SecretUnavailable(format!("create {}: {e}", dir.display())))?;
    let secret = random_bytes::<SECRET_LEN>()?;
    write_owner_only(&path, &secret)
        .map_err(|e| PresenceError::SecretUnavailable(format!("write {}: {e}", path.display())))?;
    Ok(secret)
}

/// Canonical bytes a capability's HMAC is computed over. Fields are joined
/// with a control character (`\u{1}`) unlikely to appear in any of them —
/// this is a cooperative-boundary protocol (D7 §1), not hardened against an
/// adversary choosing the target IDs, so a plain delimiter is sufficient.
///
/// Private helper called from exactly two places (`mint_in`, test-only
/// `verify_in`); a struct purely to satisfy the arg-count lint would be
/// unrequested abstraction for a one-shot serializer, hence the scoped allow.
#[allow(clippy::too_many_arguments)]
fn signed_bytes(
    protocol_version: u32,
    action: PresenceAction,
    target_ids: &[String],
    base_digest: &str,
    caller_id: &str,
    operation_id: &str,
    nonce: &[u8],
    minted_at: u64,
    expires_at: u64,
) -> Vec<u8> {
    let parts = vec![
        protocol_version.to_string(),
        action.as_str().to_string(),
        target_ids.join("\u{1}"),
        base_digest.to_string(),
        caller_id.to_string(),
        operation_id.to_string(),
        hex(nonce),
        minted_at.to_string(),
        expires_at.to_string(),
    ];
    parts.join("\u{2}").into_bytes()
}

/// Mints a capability for `request`, using the secret under `dir` and `now`
/// as the mint time. Split out from [`mint`] so tests can control both the
/// secret's home directory and the clock without touching process state.
fn mint_in(
    dir: &Path,
    now: u64,
    request: PresenceRequest,
) -> Result<PresenceCapability, PresenceError> {
    let secret = load_or_create_secret_in(dir)?;
    let nonce = random_bytes::<NONCE_LEN>()?;
    let expires_at = now.saturating_add(CAPABILITY_TTL_SECS);
    let bytes = signed_bytes(
        PROTOCOL_VERSION,
        request.action,
        &request.target_ids,
        &request.base_digest,
        &request.caller_id,
        &request.operation_id,
        &nonce,
        now,
        expires_at,
    );
    let mut mac = HmacSha256::new_from_slice(&secret)
        .expect("HMAC accepts a key of any length, including SECRET_LEN");
    mac.update(&bytes);
    let mac: [u8; 32] = mac.finalize().into_bytes().into();
    Ok(PresenceCapability {
        action: request.action,
        target_ids: request.target_ids,
        base_digest: request.base_digest,
        caller_id: request.caller_id,
        operation_id: request.operation_id,
        minted_at: now,
        expires_at,
        protocol_version: PROTOCOL_VERSION,
        nonce,
        mac,
    })
}

/// Mints a capability for `request` against the real per-install secret and
/// the real clock. Not called from any `#[tauri::command]` today — see the
/// module doc comment for why (no daemon endpoint exists yet to submit the
/// resulting mutation to).
pub fn mint(request: PresenceRequest) -> Result<PresenceCapability, PresenceError> {
    mint_in(&app_data_dir(), now_unix_secs(), request)
}

/// Recomputes a capability's HMAC against `secret` and reports whether it
/// matches and is unexpired at `now`. Exercises the same binding the daemon
/// would eventually need to check; kept `pub(crate)` since nothing outside
/// this module's tests calls it yet.
#[cfg(test)]
fn verify_in(cap: &PresenceCapability, secret: &[u8], now: u64) -> bool {
    if cap.is_expired_at(now) {
        return false;
    }
    let bytes = signed_bytes(
        cap.protocol_version,
        cap.action,
        &cap.target_ids,
        &cap.base_digest,
        &cap.caller_id,
        &cap.operation_id,
        &cap.nonce,
        cap.minted_at,
        cap.expires_at,
    );
    let mut mac = match HmacSha256::new_from_slice(secret) {
        Ok(mac) => mac,
        Err(_) => return false,
    };
    mac.update(&bytes);
    mac.verify_slice(&cap.mac).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> PresenceRequest {
        PresenceRequest {
            action: PresenceAction::ReviewPage,
            target_ids: vec!["page-1".to_string()],
            base_digest: "digest-a".to_string(),
            caller_id: "app".to_string(),
            operation_id: "op-1".to_string(),
        }
    }

    #[test]
    fn mint_creates_an_owner_only_secret_on_first_use() {
        let tmp = tempfile::tempdir().unwrap();
        let cap = mint_in(tmp.path(), 1_000, request()).expect("mint succeeds");
        assert_eq!(cap.expires_at, 1_060);

        let secret_path = secret_path_in(tmp.path());
        assert!(secret_path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&secret_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn mint_reuses_the_same_secret_across_calls() {
        let tmp = tempfile::tempdir().unwrap();
        let first = mint_in(tmp.path(), 1_000, request()).unwrap();
        let secret = load_or_create_secret_in(tmp.path()).unwrap();
        assert!(verify_in(&first, &secret, 1_000));

        let second = mint_in(tmp.path(), 1_001, request()).unwrap();
        assert!(verify_in(&second, &secret, 1_001));
    }

    #[test]
    fn a_capability_is_valid_only_for_its_own_action_and_target_t4() {
        let tmp = tempfile::tempdir().unwrap();
        let cap = mint_in(tmp.path(), 1_000, request()).unwrap();
        let secret = load_or_create_secret_in(tmp.path()).unwrap();
        assert!(verify_in(&cap, &secret, 1_000));

        let mut retargeted = cap.clone();
        retargeted.action = PresenceAction::AttestClaim;
        assert!(!verify_in(&retargeted, &secret, 1_000));

        let mut different_page = cap.clone();
        different_page.target_ids = vec!["page-2".to_string()];
        assert!(!verify_in(&different_page, &secret, 1_000));
    }

    #[test]
    fn a_capability_is_valid_only_for_its_own_base_digest_t6() {
        let tmp = tempfile::tempdir().unwrap();
        let cap = mint_in(tmp.path(), 1_000, request()).unwrap();
        let secret = load_or_create_secret_in(tmp.path()).unwrap();

        let mut stale = cap.clone();
        stale.base_digest = "digest-b".to_string();
        assert!(!verify_in(&stale, &secret, 1_000));
    }

    #[test]
    fn a_capability_expires_sixty_seconds_after_minting_t5() {
        let tmp = tempfile::tempdir().unwrap();
        let cap = mint_in(tmp.path(), 1_000, request()).unwrap();
        let secret = load_or_create_secret_in(tmp.path()).unwrap();

        assert!(verify_in(&cap, &secret, 1_059));
        assert!(!verify_in(&cap, &secret, 1_060));
    }

    #[test]
    fn a_capability_from_a_rotated_secret_does_not_verify() {
        let tmp = tempfile::tempdir().unwrap();
        let cap = mint_in(tmp.path(), 1_000, request()).unwrap();

        let other_secret = [7_u8; SECRET_LEN];
        assert!(!verify_in(&cap, &other_secret, 1_000));
    }

    #[test]
    fn debug_output_never_leaks_the_mac_or_the_raw_nonce_t9() {
        let tmp = tempfile::tempdir().unwrap();
        let cap = mint_in(tmp.path(), 1_000, request()).unwrap();
        let secret = load_or_create_secret_in(tmp.path()).unwrap();

        let debug_output = format!("{cap:?}");
        assert!(!debug_output.contains(&hex(cap.nonce)));
        assert!(!debug_output.contains(&hex(secret)));
        assert!(!debug_output.contains(&hex(cap.mac)));
        assert!(debug_output.contains("<redacted>"));
        assert!(debug_output.contains(&cap.nonce_digest()));
    }

    #[test]
    fn a_corrupt_secret_file_is_replaced_rather_than_trusted() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path()).unwrap();
        std::fs::write(secret_path_in(tmp.path()), b"too-short").unwrap();

        let secret = load_or_create_secret_in(tmp.path()).expect("regenerates instead of erroring");
        assert_eq!(secret.len(), SECRET_LEN);
    }

    #[test]
    fn secret_unavailable_surfaces_as_an_error_not_a_silent_bypass() {
        // A path segment that is a file, not a directory, makes
        // `create_dir_all` for anything under it fail — the closest portable
        // stand-in for "the secret's home directory cannot be created or
        // written", which must refuse rather than mint anyway (D7 §5).
        let tmp = tempfile::tempdir().unwrap();
        let blocked_file = tmp.path().join("not-a-directory");
        std::fs::write(&blocked_file, b"x").unwrap();
        let unusable_dir = blocked_file.join("presence");

        let result = mint_in(&unusable_dir, 1_000, request());
        assert!(matches!(result, Err(PresenceError::SecretUnavailable(_))));
    }
}
