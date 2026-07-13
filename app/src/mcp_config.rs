// SPDX-License-Identifier: AGPL-3.0-only
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpClient {
    pub name: String,
    pub client_type: String,
    pub config_path: String,
    pub detected: bool,
    pub already_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WenlanMcpEntry {
    pub command: String,
    pub args: Vec<String>,
}

/// Returns the expected config file path for each MCP client on macOS.
pub fn client_config_path(client_type: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match client_type {
        "claude_desktop" => {
            // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
            dirs::config_dir().map(|d| d.join("Claude").join("claude_desktop_config.json"))
        }
        "cursor" => Some(home.join(".cursor").join("mcp.json")),
        "claude_code" => Some(home.join(".claude.json")),
        "gemini_cli" => Some(home.join(".gemini").join("settings.json")),
        "codex_cli" => Some(home.join(".codex").join("config.toml")),
        _ => None,
    }
}

const MCP_SERVER_KEY: &str = "wenlan";
const LEGACY_MCP_SERVER_KEY: &str = "origin";

/// Check if a JSON config string already has a Wenlan entry or legacy Origin entry.
fn has_configured_entry(json_str: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|v| {
            let servers = v.get("mcpServers")?;
            Some(
                servers.get(MCP_SERVER_KEY).is_some()
                    || servers.get(LEGACY_MCP_SERVER_KEY).is_some(),
            )
        })
        .unwrap_or(false)
}

/// TOML variant for Codex CLI (`[mcp_servers.*]` tables).
fn has_configured_entry_toml(toml_str: &str) -> bool {
    toml_str
        .parse::<toml_edit::DocumentMut>()
        .ok()
        .and_then(|doc| {
            let servers = doc.get("mcp_servers")?;
            Some(
                servers.get(MCP_SERVER_KEY).is_some()
                    || servers.get(LEGACY_MCP_SERVER_KEY).is_some(),
            )
        })
        .unwrap_or(false)
}

/// Whether a Claude Code `settings.json` blob has the Wenlan plugin enabled.
/// `enabledPlugins` keys are `<plugin>@<marketplace>`, and the marketplace
/// name varies by install (`wenlan@7xuanlu` fresh, `wenlan@7xuanlu-wenlan` on
/// a machine that added the old self-marketplace) — match the `wenlan@`
/// prefix, never a literal marketplace name, or the check breaks for exactly
/// one of the two populations. Malformed JSON or a missing key is "no
/// plugin", never an error: a user who has never touched plugins should not
/// see this crash the detector.
fn claude_code_plugin_enabled(settings_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(settings_json)
        .ok()
        .and_then(|v| v.get("enabledPlugins")?.as_object().cloned())
        .map(|plugins| {
            plugins
                .iter()
                .any(|(key, val)| key.starts_with("wenlan@") && val.as_bool() == Some(true))
        })
        .unwrap_or(false)
}

/// Reads the real `~/.claude/settings.json` and checks it via
/// `claude_code_plugin_enabled`. Split out so the matching logic stays a pure,
/// directly testable function.
fn claude_code_plugin_enabled_on_disk() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    std::fs::read_to_string(home.join(".claude").join("settings.json"))
        .map(|s| claude_code_plugin_enabled(&s))
        .unwrap_or(false)
}

/// Whether a Codex CLI `config.toml` blob has the Wenlan plugin enabled —
/// `[plugins."wenlan@<marketplace>"] enabled = true`. The marketplace name
/// varies (`wenlan-local` pre-7xuanlu/wenlan#348, `7xuanlu-wenlan` after),
/// so match the `wenlan@` prefix, never a literal marketplace name — same
/// reasoning as `claude_code_plugin_enabled`.
fn codex_cli_plugin_enabled(toml_str: &str) -> bool {
    toml_str
        .parse::<toml_edit::DocumentMut>()
        .ok()
        .and_then(|doc| {
            let plugins = doc.get("plugins")?.as_table_like()?;
            Some(plugins.iter().any(|(key, item)| {
                key.starts_with("wenlan@")
                    && item.get("enabled").and_then(|v| v.as_bool()) == Some(true)
            }))
        })
        .unwrap_or(false)
}

/// Reads the real `~/.codex/config.toml` and checks it via
/// `codex_cli_plugin_enabled`. Split out so the matching logic stays a pure,
/// directly testable function.
fn codex_cli_plugin_enabled_on_disk() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    std::fs::read_to_string(home.join(".codex").join("config.toml"))
        .map(|s| codex_cli_plugin_enabled(&s))
        .unwrap_or(false)
}

/// Whether a Claude Desktop chat-side plugin manifest (`rpm/manifest.json`
/// under a session directory) lists the Wenlan plugin. True iff `plugins[]`
/// contains an entry whose `name` field is exactly `"wenlan"` — matching
/// `marketplaceName` instead would be wrong, since a user's own upload
/// marketplace can be named anything (`marketplaceName` values seen in the
/// wild: `"My Uploads"`, `"knowledge-work-plugins"`). Malformed JSON or a
/// missing `plugins` key is "no plugin", never an error — same policy as
/// `claude_code_plugin_enabled`.
fn claude_desktop_plugin_enabled(manifest_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(manifest_json)
        .ok()
        .and_then(|v| v.get("plugins")?.as_array().cloned())
        .map(|plugins| {
            plugins
                .iter()
                .any(|p| p.get("name").and_then(|n| n.as_str()) == Some("wenlan"))
        })
        .unwrap_or(false)
}

/// Extract the pinned account id (`lastKnownAccountUuid`) from a Claude
/// Desktop `config.json` blob. `None` on malformed JSON or a missing key.
fn claude_desktop_account_id(config_json: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(config_json)
        .ok()?
        .get("lastKnownAccountUuid")?
        .as_str()
        .map(String::from)
}

/// The directory holding one subdirectory per chat-side session id for a
/// given account: `<support_dir>/local-agent-mode-sessions/<account_id>`.
/// Pure path construction, so a typo in either hardcoded segment fails a
/// test that reads the returned path directly, rather than surfacing as an
/// unexplained `false` several calls downstream. Scoping to the pinned
/// account id also means the `skills-plugin` sentinel directory that lives
/// alongside real account-id directories under `local-agent-mode-sessions/`
/// is never visited — it isn't a UUID, so it can never be `account_id`.
fn claude_desktop_account_sessions_dir(support_dir: &Path, account_id: &str) -> PathBuf {
    support_dir
        .join("local-agent-mode-sessions")
        .join(account_id)
}

/// Whether any session under `account_sessions_dir` has a
/// `rpm/manifest.json` listing the Wenlan plugin. One directory per session
/// id; any single session counting is enough (a user can have several open
/// at once). A session directory without `rpm/manifest.json`, or with one
/// that fails to parse, is silently skipped — never a panic, never treated
/// as a match.
fn claude_desktop_plugin_enabled_in_sessions_dir(account_sessions_dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(account_sessions_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        std::fs::read_to_string(entry.path().join("rpm").join("manifest.json"))
            .map(|s| claude_desktop_plugin_enabled(&s))
            .unwrap_or(false)
    })
}

/// Whether the Wenlan plugin is enabled for Claude Desktop, given the
/// already-resolved support directory (normally
/// `~/Library/Application Support/Claude`). Composes
/// `claude_desktop_account_id` + `claude_desktop_account_sessions_dir` +
/// `claude_desktop_plugin_enabled_in_sessions_dir` end to end, so the full
/// real-world path — `config.json` -> account id -> sessions dir -> manifest
/// scan — is exercised under test with a tempdir standing in for
/// `support_dir`. That leaves nothing for `claude_desktop_plugin_enabled_on_disk`
/// or its `detect_mcp_clients` call site to quietly sever.
fn claude_desktop_plugin_enabled_for_support_dir(support_dir: &Path) -> bool {
    let Some(account_id) = std::fs::read_to_string(support_dir.join("config.json"))
        .ok()
        .and_then(|s| claude_desktop_account_id(&s))
    else {
        return false;
    };
    claude_desktop_plugin_enabled_in_sessions_dir(&claude_desktop_account_sessions_dir(
        support_dir,
        &account_id,
    ))
}

/// Reads the real Claude Desktop support directory
/// (`~/Library/Application Support/Claude`) and checks it via
/// `claude_desktop_plugin_enabled_for_support_dir`. Split out so the
/// matching/composition logic stays directly testable — mirrors
/// `claude_code_plugin_enabled_on_disk` and `codex_cli_plugin_enabled_on_disk`.
/// Missing home dir is "no plugin", never an error: a user who has never
/// opened Claude Desktop must not see this break detection. READ-ONLY: never
/// creates, writes, or modifies anything under Claude Desktop's support
/// directory — that state belongs to another vendor's app.
fn claude_desktop_plugin_enabled_on_disk() -> bool {
    let Some(support_dir) = dirs::config_dir().map(|d| d.join("Claude")) else {
        return false;
    };
    claude_desktop_plugin_enabled_for_support_dir(&support_dir)
}

/// Where ChatGPT desktop can be installed. Its Codex pane reads the same
/// `~/.codex/config.toml` as Codex CLI (OpenAI merged Codex into the ChatGPT
/// app), so finding the bundle means the `codex_cli` row applies.
fn chatgpt_app_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from("/Applications/ChatGPT.app")];
    if let Some(home) = home {
        out.push(home.join("Applications/ChatGPT.app"));
    }
    out
}

/// Whether the Codex CLI row should be detected: either its shared
/// `~/.codex/config.toml` exists, or ChatGPT desktop is installed. Feeds the
/// single `codex_cli` row — never a second row for ChatGPT.
///
/// `exists` is injected so the bundle paths themselves are under test: a typo
/// in a candidate path fails `codex_cli_detected_finds_chatgpt_in_*`, and the
/// call site cannot silently opt out of the probe (there is no bool to pass).
fn codex_cli_detected(
    config_exists: bool,
    home: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> bool {
    config_exists
        || chatgpt_app_candidates(home)
            .iter()
            .any(|p| exists(p.as_path()))
}

/// Detect installed MCP-compatible tools and whether Wenlan is already configured.
pub fn detect_mcp_clients() -> Vec<McpClient> {
    let clients = [
        ("Cursor", "cursor"),
        ("Claude Code", "claude_code"),
        ("Claude Desktop", "claude_desktop"),
        ("Gemini CLI", "gemini_cli"),
        ("Codex CLI", "codex_cli"),
    ];

    clients
        .iter()
        .filter_map(|(name, client_type)| {
            let config_path = client_config_path(client_type)?;
            let config_path_str = config_path.to_string_lossy().to_string();

            let is_toml = *client_type == "codex_cli";
            let config_has_entry = || {
                config_path.exists()
                    && std::fs::read_to_string(&config_path)
                        .map(|s| {
                            if is_toml {
                                has_configured_entry_toml(&s)
                            } else {
                                has_configured_entry(&s)
                            }
                        })
                        .unwrap_or(false)
            };

            let (detected, already_configured) = if client_type == &"cursor" {
                // Cursor: detect by app bundle, not config file
                let app_exists = std::path::Path::new("/Applications/Cursor.app").exists()
                    || dirs::home_dir()
                        .map(|h| h.join("Applications/Cursor.app").exists())
                        .unwrap_or(false);
                (app_exists, config_has_entry())
            } else if client_type == &"claude_code" {
                // Claude Code also counts as configured via the Wenlan plugin
                // (`enabledPlugins` in `~/.claude/settings.json`), which
                // registers its own MCP server without touching
                // `~/.claude.json` — see claude_code_plugin_enabled.
                (
                    config_path.exists(),
                    config_has_entry() || claude_code_plugin_enabled_on_disk(),
                )
            } else if client_type == &"codex_cli" {
                // Codex CLI also counts as configured via the Wenlan plugin
                // (`[plugins."wenlan@<marketplace>"]` in
                // `~/.codex/config.toml`), which registers its own MCP
                // server without a separate `[mcp_servers.wenlan]` entry —
                // see codex_cli_plugin_enabled.
                //
                // Detection also fires off ChatGPT desktop's app bundle:
                // ChatGPT desktop's Codex pane reads the same
                // `~/.codex/config.toml` as Codex CLI, so a user who only
                // has ChatGPT desktop (never ran Codex CLI) still gets this
                // row — see codex_cli_detected.
                (
                    codex_cli_detected(config_path.exists(), dirs::home_dir().as_deref(), |p| {
                        p.exists()
                    }),
                    config_has_entry() || codex_cli_plugin_enabled_on_disk(),
                )
            } else if client_type == &"claude_desktop" {
                // Claude Desktop also counts as configured via the chat-side
                // Wenlan plugin (`rpm/manifest.json` under a session
                // directory in `local-agent-mode-sessions/<account_id>/`),
                // which registers its own MCP server without touching
                // `claude_desktop_config.json` — see
                // claude_desktop_plugin_enabled_on_disk.
                (
                    config_path.exists(),
                    config_has_entry() || claude_desktop_plugin_enabled_on_disk(),
                )
            } else {
                // Everything else: detect by config file existence
                (config_path.exists(), config_has_entry())
            };

            Some(McpClient {
                name: name.to_string(),
                client_type: client_type.to_string(),
                config_path: config_path_str,
                detected,
                already_configured,
            })
        })
        .collect()
}

/// Search for a local wenlan-mcp binary. Order: dev checkout paths (unchanged),
/// then the canonical `install.sh` location, then a sidecar bundled next to
/// this binary (the only real path for a `.dmg`-only user who never ran
/// `install.sh`). `npx -y wenlan-mcp` (unpinned) is the caller's last resort,
/// not this function's.
fn find_wenlan_mcp_binary() -> Option<PathBuf> {
    let mut candidates = vec![
        dirs::home_dir().map(|h| h.join(".cargo/bin/wenlan-mcp")),
        dirs::home_dir().map(|h| h.join("Repos/wenlan/target/release/wenlan-mcp")),
        dirs::home_dir().map(|h| h.join("Repos/wenlan/target/debug/wenlan-mcp")),
        dirs::home_dir().map(|h| h.join(".wenlan/bin/wenlan-mcp")),
    ];
    if let Ok(exe) = std::env::current_exe() {
        candidates.push(exe.parent().map(|dir| dir.join("wenlan-mcp")));
    }
    candidates.into_iter().flatten().find(|p| p.exists())
}

/// The MCP config entry Wenlan writes into client config files.
/// Default: npx (production path, requires wenlan-mcp published to npm).
/// Dev fallback: uses local binary if found on disk.
pub fn wenlan_mcp_entry() -> WenlanMcpEntry {
    // Dev fallback: use local binary if available
    if let Some(binary_path) = find_wenlan_mcp_binary() {
        return WenlanMcpEntry {
            command: binary_path.to_string_lossy().to_string(),
            args: Vec::new(),
        };
    }
    // Production default
    WenlanMcpEntry {
        command: "npx".to_string(),
        args: vec!["-y".to_string(), "wenlan-mcp".to_string()],
    }
}

/// Write the Wenlan MCP server entry into a client's config file.
/// Existing legacy `origin` entries are preserved and still detected.
/// If `is_claude_code` is true and the file doesn't exist, returns an error
/// (Claude Code manages its own config file).
pub fn write_wenlan_entry(
    config_path: &std::path::Path,
    is_claude_code: bool,
) -> Result<(), AppError> {
    let mut root = if config_path.exists() {
        // Back up existing file
        let backup_path = config_path.with_extension("json.bak");
        std::fs::copy(config_path, &backup_path)?;

        let contents = std::fs::read_to_string(config_path)?;
        serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| {
            AppError::Generic(format!("Invalid JSON in {}: {}", config_path.display(), e))
        })?
    } else if is_claude_code {
        return Err(AppError::Generic(
            "Claude Code config file not found — Claude Code manages this file internally".into(),
        ));
    } else {
        // Create minimal skeleton for Claude Desktop / Cursor
        serde_json::json!({})
    };

    // Ensure mcpServers key exists
    if root.get("mcpServers").is_none() {
        root["mcpServers"] = serde_json::json!({});
    }
    root["mcpServers"][MCP_SERVER_KEY] =
        serde_json::to_value(wenlan_mcp_entry()).map_err(|e| AppError::Generic(e.to_string()))?;

    // Write back with pretty formatting
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let formatted =
        serde_json::to_string_pretty(&root).map_err(|e| AppError::Generic(e.to_string()))?;
    std::fs::write(config_path, formatted)?;

    Ok(())
}

/// Upsert the Wenlan entry into a Codex CLI `config.toml` — format-preserving:
/// user comments, key order, and unrelated tables survive byte-for-byte
/// (toml_edit round-trips everything it didn't touch).
pub fn write_wenlan_entry_toml(config_path: &std::path::Path) -> Result<(), AppError> {
    use toml_edit::{DocumentMut, Item, Table};

    let mut doc: DocumentMut = if config_path.exists() {
        let backup_path = config_path.with_extension("toml.bak");
        std::fs::copy(config_path, &backup_path)?;
        let contents = std::fs::read_to_string(config_path)?;
        contents.parse().map_err(|e| {
            AppError::Generic(format!("Invalid TOML in {}: {}", config_path.display(), e))
        })?
    } else {
        DocumentMut::new()
    };

    if doc.get("mcp_servers").is_none() {
        let mut parent = Table::new();
        parent.set_implicit(true); // render only [mcp_servers.wenlan], no bare [mcp_servers]
        doc.insert("mcp_servers", Item::Table(parent));
    }

    let entry = wenlan_mcp_entry();
    let mut server = Table::new();
    server.insert("command", toml_edit::value(entry.command));
    let mut args = toml_edit::Array::new();
    for a in entry.args {
        args.push(a);
    }
    server.insert("args", toml_edit::value(args));
    doc["mcp_servers"][MCP_SERVER_KEY] = Item::Table(server);

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(config_path, doc.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_config_path_claude_desktop() {
        let path = client_config_path("claude_desktop").unwrap();
        assert!(path.to_string_lossy().contains("Claude"));
        assert!(path
            .to_string_lossy()
            .ends_with("claude_desktop_config.json"));
    }

    #[test]
    fn test_client_config_path_cursor() {
        let path = client_config_path("cursor").unwrap();
        assert!(path.to_string_lossy().contains(".cursor"));
        assert!(path.to_string_lossy().ends_with("mcp.json"));
    }

    #[test]
    fn test_client_config_path_claude_code() {
        let path = client_config_path("claude_code").unwrap();
        assert!(path.to_string_lossy().ends_with(".claude.json"));
    }

    #[test]
    fn test_client_config_path_unknown() {
        assert!(client_config_path("unknown").is_none());
    }

    #[test]
    fn test_check_already_configured_finds_legacy_origin() {
        let json =
            r#"{"mcpServers": {"origin": {"command": "npx", "args": ["-y", "origin-mcp"]}}}"#;
        assert!(has_configured_entry(json));
    }

    #[test]
    fn test_check_already_configured_finds_wenlan() {
        let json =
            r#"{"mcpServers": {"wenlan": {"command": "npx", "args": ["-y", "wenlan-mcp"]}}}"#;
        assert!(has_configured_entry(json));
    }

    #[test]
    fn test_check_already_configured_not_found() {
        let json = r#"{"mcpServers": {"other-server": {}}}"#;
        assert!(!has_configured_entry(json));
    }

    #[test]
    fn test_check_already_configured_no_mcp_servers_key() {
        let json = r#"{"theme": "dark"}"#;
        assert!(!has_configured_entry(json));
    }

    #[test]
    fn test_check_already_configured_invalid_json() {
        assert!(!has_configured_entry("not json"));
    }

    #[test]
    fn test_claude_code_plugin_enabled_matches_fresh_install_prefix() {
        // Fresh install: marketplace name is the short form.
        let json = r#"{"enabledPlugins": {"wenlan@7xuanlu": true}}"#;
        assert!(claude_code_plugin_enabled(json));
    }

    #[test]
    fn test_claude_code_plugin_enabled_matches_legacy_marketplace_name() {
        // A machine that added the old self-hosted marketplace before it was
        // deleted upstream (048d77a8) — must still match, since matching is
        // by the `wenlan@` prefix, not a literal marketplace name.
        let json = r#"{"enabledPlugins": {"wenlan@7xuanlu-wenlan": true}}"#;
        assert!(claude_code_plugin_enabled(json));
    }

    #[test]
    fn test_claude_code_plugin_enabled_false_when_disabled() {
        let json = r#"{"enabledPlugins": {"wenlan@7xuanlu": false}}"#;
        assert!(!claude_code_plugin_enabled(json));
    }

    #[test]
    fn test_claude_code_plugin_enabled_false_when_no_wenlan_entry() {
        let json = r#"{"enabledPlugins": {"other-plugin@somewhere": true}}"#;
        assert!(!claude_code_plugin_enabled(json));
    }

    #[test]
    fn test_claude_code_plugin_enabled_false_when_no_enabled_plugins_key() {
        let json = r#"{"theme": "dark"}"#;
        assert!(!claude_code_plugin_enabled(json));
    }

    #[test]
    fn test_claude_code_plugin_enabled_false_on_malformed_json() {
        assert!(!claude_code_plugin_enabled("not json"));
    }

    #[test]
    fn test_codex_cli_plugin_enabled_matches_pre_rename_marketplace() {
        let toml = "[plugins.\"wenlan@wenlan-local\"]\nenabled = true\n";
        assert!(codex_cli_plugin_enabled(toml));
    }

    #[test]
    fn test_codex_cli_plugin_enabled_matches_post_rename_marketplace() {
        // 7xuanlu/wenlan#348 renames the marketplace to match Claude's — must
        // still match, since matching is by the `wenlan@` prefix, not a
        // literal marketplace name.
        let toml = "[plugins.\"wenlan@7xuanlu-wenlan\"]\nenabled = true\n";
        assert!(codex_cli_plugin_enabled(toml));
    }

    #[test]
    fn test_codex_cli_plugin_enabled_false_when_disabled() {
        let toml = "[plugins.\"wenlan@wenlan-local\"]\nenabled = false\n";
        assert!(!codex_cli_plugin_enabled(toml));
    }

    #[test]
    fn test_codex_cli_plugin_enabled_false_when_no_wenlan_entry() {
        let toml = "[plugins.\"other@somewhere\"]\nenabled = true\n";
        assert!(!codex_cli_plugin_enabled(toml));
    }

    #[test]
    fn test_codex_cli_plugin_enabled_false_when_no_plugins_key() {
        let toml = "model = \"gpt-5.5\"\n";
        assert!(!codex_cli_plugin_enabled(toml));
    }

    #[test]
    fn test_codex_cli_plugin_enabled_false_on_malformed_toml() {
        assert!(!codex_cli_plugin_enabled("not toml ["));
    }

    /// Manifest fixture matching the real shape seen on a live machine:
    /// `wenlan` present, plus another entry whose `marketplaceName` ("My
    /// Uploads") deliberately differs from its `name` ("social-media-skills")
    /// — a name/marketplaceName mixup would false-positive on this fixture.
    fn manifest_with_wenlan() -> &'static str {
        r#"{"plugins": [
            {"id": "plugin_1", "name": "social-media-skills", "marketplaceId": "m1", "marketplaceName": "My Uploads"},
            {"id": "plugin_2", "name": "wenlan", "marketplaceId": "m2", "marketplaceName": "wenlan"}
        ]}"#
    }

    #[test]
    fn test_claude_desktop_plugin_enabled_true_for_exact_name() {
        assert!(claude_desktop_plugin_enabled(manifest_with_wenlan()));
    }

    #[test]
    fn test_claude_desktop_plugin_enabled_false_for_similar_name() {
        // Guards against a `starts_with`/`contains` match instead of exact
        // equality: "wenlan-old" must not count as "wenlan".
        let json =
            r#"{"plugins": [{"id": "p1", "name": "wenlan-old", "marketplaceName": "wenlan"}]}"#;
        assert!(!claude_desktop_plugin_enabled(json));
    }

    #[test]
    fn test_claude_desktop_plugin_enabled_false_when_only_marketplace_name_matches() {
        // The entry's `name` is "other-plugin"; only `marketplaceName` says
        // "wenlan". Matching the wrong field would false-positive here.
        let json =
            r#"{"plugins": [{"id": "p1", "name": "other-plugin", "marketplaceName": "wenlan"}]}"#;
        assert!(!claude_desktop_plugin_enabled(json));
    }

    #[test]
    fn test_claude_desktop_plugin_enabled_false_case_mismatch() {
        let json = r#"{"plugins": [{"id": "p1", "name": "Wenlan"}]}"#;
        assert!(!claude_desktop_plugin_enabled(json));
    }

    #[test]
    fn test_claude_desktop_plugin_enabled_false_when_no_plugins_key() {
        assert!(!claude_desktop_plugin_enabled(r#"{"lastUpdated": 1}"#));
    }

    #[test]
    fn test_claude_desktop_plugin_enabled_false_on_malformed_json() {
        assert!(!claude_desktop_plugin_enabled("not json"));
    }

    #[test]
    fn test_claude_desktop_account_id_extracts_last_known_account_uuid() {
        let json = r#"{"lastKnownAccountUuid": "acct-123", "locale": "en-US"}"#;
        assert_eq!(
            claude_desktop_account_id(json),
            Some("acct-123".to_string())
        );
    }

    #[test]
    fn test_claude_desktop_account_id_none_when_key_missing() {
        assert_eq!(claude_desktop_account_id(r#"{"locale": "en-US"}"#), None);
    }

    #[test]
    fn test_claude_desktop_account_id_none_on_malformed_json() {
        assert_eq!(claude_desktop_account_id("not json"), None);
    }

    #[test]
    fn test_claude_desktop_account_sessions_dir_joins_expected_segments() {
        let support_dir = Path::new("/support");
        let dir = claude_desktop_account_sessions_dir(support_dir, "acct-1");
        assert_eq!(dir, Path::new("/support/local-agent-mode-sessions/acct-1"));
    }

    #[test]
    fn test_sessions_dir_true_when_one_session_has_wenlan() {
        let tmp = tempfile::tempdir().unwrap();
        let session_dir = tmp.path().join("sess-1").join("rpm");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("manifest.json"), manifest_with_wenlan()).unwrap();
        assert!(claude_desktop_plugin_enabled_in_sessions_dir(tmp.path()));
    }

    #[test]
    fn test_sessions_dir_true_when_second_of_two_sessions_has_wenlan() {
        let tmp = tempfile::tempdir().unwrap();
        let no_wenlan = tmp.path().join("sess-a").join("rpm");
        std::fs::create_dir_all(&no_wenlan).unwrap();
        std::fs::write(
            no_wenlan.join("manifest.json"),
            r#"{"plugins": [{"id": "p1", "name": "engineering"}]}"#,
        )
        .unwrap();

        let with_wenlan = tmp.path().join("sess-b").join("rpm");
        std::fs::create_dir_all(&with_wenlan).unwrap();
        std::fs::write(with_wenlan.join("manifest.json"), manifest_with_wenlan()).unwrap();

        assert!(claude_desktop_plugin_enabled_in_sessions_dir(tmp.path()));
    }

    #[test]
    fn test_sessions_dir_false_when_dir_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!claude_desktop_plugin_enabled_in_sessions_dir(
            &tmp.path().join("does-not-exist")
        ));
    }

    #[test]
    fn test_sessions_dir_false_when_no_rpm_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let session_dir = tmp.path().join("sess-1");
        std::fs::create_dir_all(&session_dir).unwrap();
        // manifest.json exists but not under rpm/
        std::fs::write(session_dir.join("manifest.json"), manifest_with_wenlan()).unwrap();
        assert!(!claude_desktop_plugin_enabled_in_sessions_dir(tmp.path()));
    }

    #[test]
    fn test_sessions_dir_tolerates_malformed_manifest_alongside_a_valid_one() {
        let tmp = tempfile::tempdir().unwrap();
        let broken = tmp.path().join("sess-broken").join("rpm");
        std::fs::create_dir_all(&broken).unwrap();
        std::fs::write(broken.join("manifest.json"), "not json").unwrap();

        let good = tmp.path().join("sess-good").join("rpm");
        std::fs::create_dir_all(&good).unwrap();
        std::fs::write(good.join("manifest.json"), manifest_with_wenlan()).unwrap();

        assert!(claude_desktop_plugin_enabled_in_sessions_dir(tmp.path()));
    }

    /// Builds `<tmp>/config.json` (with `lastKnownAccountUuid`) plus
    /// `<tmp>/local-agent-mode-sessions/<account_id>/<session_id>/rpm/manifest.json`
    /// — the exact shape verified on a live Claude Desktop install — so
    /// `claude_desktop_plugin_enabled_for_support_dir` is exercised
    /// end-to-end against a fake `support_dir`.
    fn write_support_dir_fixture(root: &Path, account_id: &str, session_id: &str, manifest: &str) {
        std::fs::write(
            root.join("config.json"),
            format!(r#"{{"lastKnownAccountUuid": "{account_id}"}}"#),
        )
        .unwrap();
        let rpm_dir = root
            .join("local-agent-mode-sessions")
            .join(account_id)
            .join(session_id)
            .join("rpm");
        std::fs::create_dir_all(&rpm_dir).unwrap();
        std::fs::write(rpm_dir.join("manifest.json"), manifest).unwrap();
    }

    #[test]
    fn test_support_dir_true_when_pinned_account_session_has_wenlan() {
        let tmp = tempfile::tempdir().unwrap();
        write_support_dir_fixture(tmp.path(), "acct-1", "sess-1", manifest_with_wenlan());
        assert!(claude_desktop_plugin_enabled_for_support_dir(tmp.path()));
    }

    #[test]
    fn test_support_dir_false_when_wenlan_only_under_a_different_account() {
        let tmp = tempfile::tempdir().unwrap();
        // config.json pins "acct-1", but the manifest with wenlan lives
        // under a *different* account id — must not count.
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{"lastKnownAccountUuid": "acct-1"}"#,
        )
        .unwrap();
        let rpm_dir = tmp
            .path()
            .join("local-agent-mode-sessions")
            .join("acct-2")
            .join("sess-1")
            .join("rpm");
        std::fs::create_dir_all(&rpm_dir).unwrap();
        std::fs::write(rpm_dir.join("manifest.json"), manifest_with_wenlan()).unwrap();

        assert!(!claude_desktop_plugin_enabled_for_support_dir(tmp.path()));
    }

    #[test]
    fn test_support_dir_false_when_config_json_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!claude_desktop_plugin_enabled_for_support_dir(tmp.path()));
    }

    #[test]
    fn test_support_dir_never_reads_skills_plugin_sentinel() {
        // The `skills-plugin` sentinel sits alongside the real account-id
        // directory under `local-agent-mode-sessions/` on a real machine.
        // It is not a UUID, so it can never be `lastKnownAccountUuid` — a
        // manifest planted only under it must never count.
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{"lastKnownAccountUuid": "acct-1"}"#,
        )
        .unwrap();
        let sentinel_rpm = tmp
            .path()
            .join("local-agent-mode-sessions")
            .join("skills-plugin")
            .join("sess-1")
            .join("rpm");
        std::fs::create_dir_all(&sentinel_rpm).unwrap();
        std::fs::write(sentinel_rpm.join("manifest.json"), manifest_with_wenlan()).unwrap();

        assert!(!claude_desktop_plugin_enabled_for_support_dir(tmp.path()));
    }

    /// Live-machine sanity check, not part of the default gating suite (this
    /// machine's Claude Desktop state is not portable to CI or other dev
    /// machines) — run explicitly with `cargo test --lib -- --ignored
    /// claude_desktop_detected_via_real_plugin_manifest`. This machine's
    /// `rpm/manifest.json`, under the account pinned by
    /// `~/Library/Application Support/Claude/config.json`, lists a plugin
    /// named "wenlan" (verified by hand before writing this test). If
    /// `detect_mcp_clients`'s `claude_desktop` branch is ever severed from
    /// `claude_desktop_plugin_enabled_on_disk`, this is the one test in this
    /// file that will catch it — everything else here exercises the logic
    /// against a fake `support_dir`, never the real one.
    #[test]
    #[ignore]
    fn claude_desktop_detected_via_real_plugin_manifest() {
        let claude_desktop = detect_mcp_clients()
            .into_iter()
            .find(|c| c.client_type == "claude_desktop")
            .expect("claude_desktop row always present");
        assert!(
            claude_desktop.already_configured,
            "expected already_configured=true: this machine has the Wenlan chat-side plugin installed"
        );
    }

    #[test]
    fn test_wenlan_mcp_entry_is_typed_command_args() {
        let entry = wenlan_mcp_entry();

        assert!(!entry.command.is_empty());
        if entry.command == "npx" {
            assert_eq!(entry.args, vec!["-y".to_string(), "wenlan-mcp".to_string()]);
        } else {
            assert!(entry.command.ends_with("wenlan-mcp"));
            assert!(entry.args.is_empty());
        }
    }

    #[test]
    fn test_write_wenlan_entry_creates_new_file() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        write_wenlan_entry(&config_path, false).unwrap();
        let contents = std::fs::read_to_string(&config_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(
            parsed["mcpServers"]["wenlan"],
            serde_json::to_value(wenlan_mcp_entry()).unwrap()
        );
        // Command is either a local binary path or npx (depending on host)
        let cmd = parsed["mcpServers"]["wenlan"]["command"].as_str().unwrap();
        assert!(
            cmd == "npx" || cmd.ends_with("wenlan-mcp"),
            "expected npx or path to wenlan-mcp, got: {cmd}"
        );
        assert!(parsed["mcpServers"]["origin"].is_null());
    }

    #[test]
    fn test_write_wenlan_entry_preserves_existing_servers() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        let existing = r#"{"mcpServers": {"other": {"command": "other-cmd"}}}"#;
        std::fs::write(&config_path, existing).unwrap();
        write_wenlan_entry(&config_path, false).unwrap();
        let contents = std::fs::read_to_string(&config_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert!(parsed["mcpServers"]["other"].is_object());
        assert!(parsed["mcpServers"]["wenlan"].is_object());
    }

    #[test]
    fn test_write_wenlan_entry_preserves_legacy_origin_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        let existing =
            r#"{"mcpServers": {"origin": {"command": "npx", "args": ["-y", "origin-mcp"]}}}"#;
        std::fs::write(&config_path, existing).unwrap();
        write_wenlan_entry(&config_path, false).unwrap();
        let contents = std::fs::read_to_string(&config_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(
            parsed["mcpServers"]["origin"]["args"],
            serde_json::json!(["-y", "origin-mcp"])
        );
        assert!(parsed["mcpServers"]["wenlan"].is_object());
    }

    #[test]
    fn test_write_wenlan_entry_creates_mcp_servers_key() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        std::fs::write(&config_path, r#"{"theme": "dark"}"#).unwrap();
        write_wenlan_entry(&config_path, false).unwrap();
        let contents = std::fs::read_to_string(&config_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["theme"], "dark");
        assert!(parsed["mcpServers"]["wenlan"].is_object());
    }

    #[test]
    fn test_write_wenlan_entry_creates_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        std::fs::write(&config_path, r#"{"original": true}"#).unwrap();
        write_wenlan_entry(&config_path, false).unwrap();
        let backup = tmp.path().join("config.json.bak");
        assert!(backup.exists());
        let backup_contents = std::fs::read_to_string(&backup).unwrap();
        assert!(backup_contents.contains("original"));
    }

    #[test]
    fn test_write_wenlan_entry_errors_on_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.json");
        std::fs::write(&config_path, "not valid json").unwrap();
        let result = write_wenlan_entry(&config_path, false);
        assert!(result.is_err());
    }

    #[test]
    fn test_write_wenlan_entry_refuses_create_for_claude_code() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("claude.json");
        // is_claude_code = true, file doesn't exist → should error
        let result = write_wenlan_entry(&config_path, true);
        assert!(result.is_err());
    }

    #[test]
    fn test_client_config_path_gemini_cli() {
        let path = client_config_path("gemini_cli").unwrap();
        assert!(path.to_string_lossy().ends_with(".gemini/settings.json"));
    }

    #[test]
    fn test_client_config_path_codex_cli() {
        let path = client_config_path("codex_cli").unwrap();
        assert!(path.to_string_lossy().ends_with(".codex/config.toml"));
    }

    /// `exists` that answers true for exactly one path — so a test failure
    /// means the probed path is wrong, not merely that some boolean was false.
    fn only(hit: &str) -> impl Fn(&Path) -> bool + '_ {
        move |p: &Path| p == Path::new(hit)
    }

    #[test]
    fn codex_cli_detected_finds_chatgpt_in_applications() {
        let home = PathBuf::from("/Users/someone");
        assert!(codex_cli_detected(
            false,
            Some(&home),
            only("/Applications/ChatGPT.app")
        ));
    }

    #[test]
    fn codex_cli_detected_finds_chatgpt_in_user_applications() {
        let home = PathBuf::from("/Users/someone");
        assert!(codex_cli_detected(
            false,
            Some(&home),
            only("/Users/someone/Applications/ChatGPT.app")
        ));
    }

    #[test]
    fn codex_cli_detected_via_config_when_chatgpt_absent() {
        let home = PathBuf::from("/Users/someone");
        assert!(codex_cli_detected(true, Some(&home), |_| false));
    }

    #[test]
    fn codex_cli_not_detected_when_neither_present() {
        let home = PathBuf::from("/Users/someone");
        assert!(!codex_cli_detected(false, Some(&home), |_| false));
        // A *different* Mac app must not be mistaken for ChatGPT desktop.
        assert!(!codex_cli_detected(
            false,
            Some(&home),
            only("/Applications/Cursor.app")
        ));
    }

    #[test]
    fn codex_cli_detected_survives_missing_home() {
        assert!(codex_cli_detected(
            false,
            None,
            only("/Applications/ChatGPT.app")
        ));
    }

    #[test]
    fn test_detect_mcp_clients_has_exactly_one_codex_cli_row() {
        // ChatGPT desktop shares ~/.codex/config.toml with Codex CLI — it
        // must fold into the existing codex_cli row, never add a second row.
        let codex_rows: Vec<_> = detect_mcp_clients()
            .into_iter()
            .filter(|c| c.client_type == "codex_cli")
            .collect();
        assert_eq!(
            codex_rows.len(),
            1,
            "ChatGPT.app detection must reuse the codex_cli row, not add a second one"
        );
    }

    #[test]
    fn test_detect_includes_new_clients() {
        let types: Vec<String> = detect_mcp_clients()
            .into_iter()
            .map(|c| c.client_type)
            .collect();
        for expected in [
            "cursor",
            "claude_code",
            "claude_desktop",
            "gemini_cli",
            "codex_cli",
        ] {
            assert!(types.contains(&expected.to_string()), "missing {expected}");
        }
    }

    #[test]
    fn test_has_configured_entry_toml() {
        assert!(has_configured_entry_toml(
            "[mcp_servers.wenlan]\ncommand = \"npx\"\nargs = [\"-y\", \"wenlan-mcp\"]\n"
        ));
        assert!(has_configured_entry_toml(
            "[mcp_servers.origin]\ncommand = \"npx\"\n"
        ));
        assert!(!has_configured_entry_toml(
            "[mcp_servers.other]\ncommand = \"x\"\n"
        ));
        assert!(!has_configured_entry_toml("model = \"gpt-5.5\"\n"));
        assert!(!has_configured_entry_toml("not toml ["));
    }

    #[test]
    fn test_write_wenlan_entry_toml_creates_new_file() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.toml");
        write_wenlan_entry_toml(&config_path).unwrap();
        let contents = std::fs::read_to_string(&config_path).unwrap();
        assert!(has_configured_entry_toml(&contents));
        let parsed: toml::Value = toml::from_str(&contents).unwrap();
        let wenlan = &parsed["mcp_servers"]["wenlan"];
        assert!(wenlan.get("command").is_some());
    }

    #[test]
    fn test_write_wenlan_entry_toml_preserves_formatting_byte_for_byte() {
        // Council change (d): a user's hand-edited config must survive the
        // upsert byte-for-byte — comments, spacing, key order, other tables.
        let fixture = r#"# my codex config — do not touch
model = "gpt-5.5"   # inline comment

[profiles.fast]
model   = "gpt-5.5-mini"

[mcp_servers.other]
command = "other-cmd"  # keep me
args = ["--flag"]
"#;
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.toml");
        std::fs::write(&config_path, fixture).unwrap();
        write_wenlan_entry_toml(&config_path).unwrap();
        let contents = std::fs::read_to_string(&config_path).unwrap();
        // Everything that existed before is preserved verbatim; the wenlan
        // table is appended after it.
        assert!(
            contents.starts_with(fixture),
            "existing content was reformatted:\n{contents}"
        );
        assert!(has_configured_entry_toml(&contents));
    }

    #[test]
    fn test_write_wenlan_entry_toml_upsert_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.toml");
        write_wenlan_entry_toml(&config_path).unwrap();
        let first = std::fs::read_to_string(&config_path).unwrap();
        write_wenlan_entry_toml(&config_path).unwrap();
        let second = std::fs::read_to_string(&config_path).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn test_write_wenlan_entry_toml_creates_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.toml");
        std::fs::write(&config_path, "model = \"gpt-5.5\"\n").unwrap();
        write_wenlan_entry_toml(&config_path).unwrap();
        let backup = tmp.path().join("config.toml.bak");
        assert!(backup.exists());
        assert!(std::fs::read_to_string(&backup)
            .unwrap()
            .contains("gpt-5.5"));
    }

    #[test]
    fn test_write_wenlan_entry_toml_errors_on_invalid_toml() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.toml");
        std::fs::write(&config_path, "not toml [").unwrap();
        assert!(write_wenlan_entry_toml(&config_path).is_err());
    }
}
