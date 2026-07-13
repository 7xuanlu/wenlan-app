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
