// SPDX-License-Identifier: AGPL-3.0-only
//! HTTP client for the Origin daemon (origin-server).
//!
//! Thin wrapper around `reqwest::Client` that maps each daemon endpoint
//! to a typed method. The Tauri app uses this instead of direct DB access.

use origin_types::responses::HealthResponse;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// HTTP client that proxies requests to the origin-server daemon.
#[derive(Clone)]
pub struct OriginClient {
    client: Client,
    base_url: String,
}

impl Default for OriginClient {
    fn default() -> Self {
        Self::new()
    }
}

impl OriginClient {
    pub fn new() -> Self {
        let port: u16 = std::env::var("ORIGIN_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(7878);
        Self {
            client: Client::new(),
            base_url: format!("http://127.0.0.1:{}", port),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    // ── Generic helpers ─────────────────────────────────────────────

    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self
            .client
            .get(self.url(path))
            .send()
            .await
            .map_err(|e| format!("HTTP GET {}: {}", path, e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP GET {} returned {}", path, resp.status()));
        }
        resp.json()
            .await
            .map_err(|e| format!("Parse {}: {}", path, e))
    }

    pub async fn post_json<Req: Serialize, Resp: DeserializeOwned>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<Resp, String> {
        let resp = self
            .client
            .post(self.url(path))
            .json(body)
            .send()
            .await
            .map_err(|e| format!("HTTP POST {}: {}", path, e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP POST {} returned {}: {}", path, status, text));
        }
        resp.json()
            .await
            .map_err(|e| format!("Parse {}: {}", path, e))
    }

    pub async fn put_json<Req: Serialize, Resp: DeserializeOwned>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<Resp, String> {
        let resp = self
            .client
            .put(self.url(path))
            .json(body)
            .send()
            .await
            .map_err(|e| format!("HTTP PUT {}: {}", path, e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP PUT {} returned {}: {}", path, status, text));
        }
        resp.json()
            .await
            .map_err(|e| format!("Parse {}: {}", path, e))
    }

    pub async fn delete_path<Resp: DeserializeOwned>(&self, path: &str) -> Result<Resp, String> {
        let resp = self
            .client
            .delete(self.url(path))
            .send()
            .await
            .map_err(|e| format!("HTTP DELETE {}: {}", path, e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP DELETE {} returned {}", path, resp.status()));
        }
        resp.json()
            .await
            .map_err(|e| format!("Parse {}: {}", path, e))
    }

    pub async fn delete_json<Req: Serialize, Resp: DeserializeOwned>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<Resp, String> {
        let resp = self
            .client
            .delete(self.url(path))
            .json(body)
            .send()
            .await
            .map_err(|e| format!("HTTP DELETE {}: {}", path, e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "HTTP DELETE {} returned {}: {}",
                path, status, text
            ));
        }
        resp.json()
            .await
            .map_err(|e| format!("Parse {}: {}", path, e))
    }

    pub async fn post_empty<Resp: DeserializeOwned>(&self, path: &str) -> Result<Resp, String> {
        let resp = self
            .client
            .post(self.url(path))
            .send()
            .await
            .map_err(|e| format!("HTTP POST {}: {}", path, e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP POST {} returned {}: {}", path, status, text));
        }
        resp.json()
            .await
            .map_err(|e| format!("Parse {}: {}", path, e))
    }

    // ── Health ──────────────────────────────────────────────────────

    pub async fn health(&self) -> Result<HealthResponse, String> {
        self.get_json("/api/health").await
    }

    // ── Chat export import ─────────────────────────────────────────

    pub async fn import_chat_export(
        &self,
        path: &str,
    ) -> Result<origin_types::import::ImportChatExportResponse, String> {
        let req = origin_types::import::ImportChatExportRequest {
            path: path.to_string(),
        };
        self.post_json("/api/import/chat-export", &req).await
    }

    pub async fn list_pending_imports(
        &self,
    ) -> Result<Vec<origin_types::import::PendingImport>, String> {
        self.get_json("/api/import/state").await
    }

    // ── Onboarding milestones ──────────────────────────────────────

    pub async fn list_onboarding_milestones(
        &self,
    ) -> Result<Vec<origin_types::onboarding::MilestoneRecord>, String> {
        self.get_json("/api/onboarding/milestones").await
    }

    pub async fn acknowledge_onboarding_milestone(&self, id: &str) -> Result<(), String> {
        let path = format!("/api/onboarding/milestones/{}/acknowledge", id);
        let resp = self
            .client
            .post(self.url(&path))
            .send()
            .await
            .map_err(|e| format!("HTTP POST {}: {}", path, e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP POST {} returned {}: {}", path, status, text));
        }
        Ok(())
    }

    pub async fn reset_onboarding_milestones(&self) -> Result<(), String> {
        let path = "/api/onboarding/reset";
        let resp = self
            .client
            .post(self.url(path))
            .send()
            .await
            .map_err(|e| format!("HTTP POST {}: {}", path, e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP POST {} returned {}: {}", path, status, text));
        }
        Ok(())
    }

    // ── Home delta feed ────────────────────────────────────────────────

    pub async fn list_recent_retrievals(
        &self,
        limit: i64,
    ) -> Result<Vec<origin_types::RetrievalEvent>, String> {
        let path = format!("/api/retrievals/recent?limit={}", limit);
        self.get_json(&path).await
    }

    pub async fn list_recent_changes(
        &self,
        limit: i64,
    ) -> Result<Vec<origin_types::PageChange>, String> {
        let path = format!("/api/pages/recent-changes?limit={}", limit);
        self.get_json(&path).await
    }

    pub async fn list_recent_memories(
        &self,
        limit: i64,
        since_ms: Option<i64>,
    ) -> Result<Vec<origin_types::RecentActivityItem>, String> {
        let path = match since_ms {
            Some(ms) => format!("/api/memory/recent?limit={}&since_ms={}", limit, ms),
            None => format!("/api/memory/recent?limit={}", limit),
        };
        self.get_json(&path).await
    }

    pub async fn list_unconfirmed_memories(
        &self,
        limit: i64,
    ) -> Result<Vec<origin_types::RecentActivityItem>, String> {
        let path = format!("/api/memory/unconfirmed?limit={}", limit);
        self.get_json(&path).await
    }

    pub async fn list_recent_pages(
        &self,
        limit: i64,
        since_ms: Option<i64>,
    ) -> Result<Vec<origin_types::RecentActivityItem>, String> {
        let path = match since_ms {
            Some(ms) => format!("/api/pages/recent?limit={}&since_ms={}", limit, ms),
            None => format!("/api/pages/recent?limit={}", limit),
        };
        self.get_json(&path).await
    }

    pub async fn list_recent_relations(
        &self,
        limit: Option<usize>,
        since_ms: Option<i64>,
    ) -> Result<Vec<origin_types::RecentRelation>, String> {
        let mut path = format!(
            "/api/knowledge/recent-relations?limit={}",
            limit.unwrap_or(10)
        );
        if let Some(ms) = since_ms {
            path.push_str(&format!("&since_ms={}", ms));
        }
        self.get_json(&path).await
    }

    pub async fn get_page_sources(
        &self,
        page_id: &str,
    ) -> Result<Vec<origin_types::PageSourceWithMemory>, String> {
        let path = format!("/api/pages/{}/sources", page_id);
        self.get_json(&path).await
    }

    pub async fn test_llm(&self, endpoint: String, model: String) -> Result<String, String> {
        let req = origin_types::requests::TestLlmRequest {
            endpoint,
            model,
            prompt: None,
        };
        let resp: origin_types::requests::TestLlmResponse =
            self.post_json("/api/llm/test", &req).await?;
        Ok(resp.response)
    }

    // ── Config ─────────────────────────────────────────────────────────────

    /// GET /api/config — return the daemon's current config.
    pub async fn get_config(&self) -> Result<origin_types::responses::ConfigResponse, String> {
        self.get_json("/api/config").await
    }

    /// PUT /api/config — update one or more fields and return the new config.
    /// Pass `Option<T>` fields; `None` leaves a field unchanged.
    pub async fn update_config(
        &self,
        req: origin_types::requests::UpdateConfigRequest,
    ) -> Result<origin_types::responses::ConfigResponse, String> {
        self.put_json("/api/config", &req).await
    }

    pub async fn get_skip_apps(&self) -> Result<Vec<String>, String> {
        Ok(self.get_config().await?.skip_apps)
    }

    pub async fn set_skip_apps(&self, apps: Vec<String>) -> Result<(), String> {
        self.update_config(empty_update().with_skip_apps(apps))
            .await
            .map(|_| ())
    }

    pub async fn get_skip_title_patterns(&self) -> Result<Vec<String>, String> {
        Ok(self.get_config().await?.skip_title_patterns)
    }

    pub async fn set_skip_title_patterns(&self, patterns: Vec<String>) -> Result<(), String> {
        self.update_config(empty_update().with_skip_title_patterns(patterns))
            .await
            .map(|_| ())
    }
}

// `UpdateConfigRequest` does not derive `Default` in origin-types 0.3.x, so
// build a baseline with every field set to `None` here. When/if origin-types
// adds the derive, these helpers can be deleted in favor of
// `UpdateConfigRequest { skip_apps: Some(...), ..Default::default() }`.
fn empty_update() -> origin_types::requests::UpdateConfigRequest {
    origin_types::requests::UpdateConfigRequest {
        skip_apps: None,
        skip_title_patterns: None,
        private_browsing_detection: None,
        setup_completed: None,
        clipboard_enabled: None,
        screen_capture_enabled: None,
        remote_access_enabled: None,
        routine_model: None,
        synthesis_model: None,
        external_llm_endpoint: None,
        external_llm_model: None,
    }
}

trait UpdateConfigBuilder {
    fn with_skip_apps(self, v: Vec<String>) -> Self;
    fn with_skip_title_patterns(self, v: Vec<String>) -> Self;
}

impl UpdateConfigBuilder for origin_types::requests::UpdateConfigRequest {
    fn with_skip_apps(mut self, v: Vec<String>) -> Self {
        self.skip_apps = Some(v);
        self
    }
    fn with_skip_title_patterns(mut self, v: Vec<String>) -> Self {
        self.skip_title_patterns = Some(v);
        self
    }
}
