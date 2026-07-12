// SPDX-License-Identifier: AGPL-3.0-only
use crate::router::bundle::{ContextBundle, TriggerSource};
use crate::state::AppState;
use crate::trigger::types::TriggerEvent;

use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::mpsc::{Receiver, Sender};
use tokio::sync::RwLock;

use wenlan_types::requests::IngestTextRequest;
use wenlan_types::responses::IngestResponse;
use wenlan_types::working_memory::{WorkingMemoryEntry, MAX_SNIPPET_CHARS};

/// Default consumer dedup threshold (matches TuningConfig default).
const DEFAULT_CONSUMER_DEDUP_THRESHOLD: f64 = 0.85;
/// Default consumer dedup window in seconds (matches TuningConfig default).
const DEFAULT_CONSUMER_DEDUP_WINDOW_SECS: i64 = 60;

/// Stable hash of a window's OCR text for per-window dedup fast path.
#[allow(dead_code)]
fn content_hash(text: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// Composite key that uniquely identifies a window across captures.
#[allow(dead_code)]
fn window_key(app_name: &str, window_title: &str) -> String {
    format!("{}\0{}", app_name, window_title)
}

/// Bigram Jaccard similarity between two strings.
///
/// Returns 0.0 (completely different) to 1.0 (identical).
fn text_similarity(a: &str, b: &str) -> f64 {
    fn bigrams(s: &str) -> HashSet<(char, char)> {
        s.chars().zip(s.chars().skip(1)).collect()
    }

    let ba = bigrams(a);
    let bb = bigrams(b);

    if ba.is_empty() && bb.is_empty() {
        return 1.0;
    }

    let intersection = ba.intersection(&bb).count();
    let union = ba.union(&bb).count();

    if union == 0 {
        return 1.0;
    }

    intersection as f64 / union as f64
}

/// The smart router — core of the unified trigger architecture.
///
/// Pattern-matches on TriggerEvent to apply the right optimization strategy:
/// - QuickThought: bypass vision entirely, send to consumer
pub async fn run_router(
    mut event_rx: Receiver<TriggerEvent>,
    bundle_tx: Sender<ContextBundle>,
    state: Arc<RwLock<AppState>>,
) {
    // Wait for daemon to be reachable
    loop {
        let client = state.read().await.client.clone();
        if client.health().await.is_ok() {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    log::info!("[router] started, waiting for trigger events...");

    while let Some(event) = event_rx.recv().await {
        match event {
            // ── QUICK THOUGHT: bypass vision entirely ──
            TriggerEvent::QuickThought { ref text } => {
                log::info!("[router] quick thought: {} chars", text.len());
                let bundle = ContextBundle::from_text(text.clone());
                let _ = bundle_tx.send(bundle).await;
            }
        }
    }

    log::info!("[router] stopped (channel closed)");
}

/// Context consumer task — receives bundles and sends them to the daemon
/// via HTTP for storage. LLM classification and space management are handled
/// by the daemon.
pub async fn run_context_consumer(
    mut bundle_rx: Receiver<ContextBundle>,
    state: Arc<RwLock<AppState>>,
) {
    // Wait for daemon to be reachable
    loop {
        let client = state.read().await.client.clone();
        if client.health().await.is_ok() {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    log::info!("[consumer] started, waiting for context bundles...");

    // Consumer dedup: track last capture to skip near-duplicates
    let mut last_consumer: Option<(String, String, i64)> = None; // (source, text, timestamp)

    while let Some(bundle) = bundle_rx.recv().await {
        let trigger_type = bundle.trigger_type.to_string();

        // Build title and content from the bundle (same logic as bundle_to_raw_document)
        let (source, source_id, title, content, url, metadata) = extract_ingest_fields(&bundle);

        // Snapshot working-memory metadata from the bundle before it's moved.
        // Quick Thought is the only bundle producer today, so this always
        // synthesizes a "Wenlan / Quick Thought" entry.
        let wm_entry_data: Option<(String, String, String)> =
            bundle.raw_text.as_ref().map(|text| {
                (
                    "Wenlan".to_string(),
                    "Quick Thought".to_string(),
                    text.chars().take(MAX_SNIPPET_CHARS).collect(),
                )
            });

        // Consumer dedup: if same content as last capture within time window, skip it
        let now_ts = chrono::Utc::now().timestamp();
        if let Some((ref prev_source, ref prev_text, prev_ts)) = last_consumer {
            let within_window = (now_ts - prev_ts) <= DEFAULT_CONSUMER_DEDUP_WINDOW_SECS;
            if within_window
                && prev_source == &source
                && text_similarity(prev_text, &content) >= DEFAULT_CONSUMER_DEDUP_THRESHOLD
            {
                log::info!("[consumer] dedup: skipping near-duplicate capture");
                continue;
            }
        }

        let client = state.read().await.client.clone();

        // Send to daemon via HTTP ingest
        let req = IngestTextRequest {
            source: source.clone(),
            source_id: source_id.clone(),
            title: title.clone(),
            content: content.clone(),
            url,
            metadata: if metadata.is_empty() {
                None
            } else {
                Some(metadata)
            },
        };

        match client
            .post_json::<IngestTextRequest, IngestResponse>("/api/ingest/text", &req)
            .await
        {
            Ok(resp) => {
                let now = chrono::Utc::now().timestamp();

                // Clone the working memory Arc out of the state guard so we
                // can push without holding the AppState write lock across
                // the Mutex acquisition.
                let wm_handle = {
                    let mut s = state.write().await;
                    s.last_ingestion_at = now;
                    s.touch_activity(bundle.timestamp.timestamp());

                    // Emit capture event to frontend (toast notification).
                    // LLM classification is handled by the daemon.
                    s.emit_capture_event(crate::state::CaptureEvent {
                        source: trigger_type.clone(),
                        source_id: source_id.clone(),
                        summary: title.clone(),
                        chunks: resp.chunks_created,
                        processing: false,
                    });

                    let handle = s.working_memory.clone();
                    // Store last bundle for retrieval via Tauri command
                    s.last_context_bundle = Some(bundle);
                    handle
                };

                // Push to working memory (rolling buffer, 15-min retention)
                if let Some((app_name, window_title, text_snippet)) = wm_entry_data {
                    let mut wm = wm_handle.lock().await;
                    wm.push(WorkingMemoryEntry {
                        timestamp: now,
                        source: trigger_type.clone(),
                        app_name,
                        window_title,
                        text_snippet,
                        source_id: source_id.clone(),
                    });
                }

                last_consumer = Some((source.clone(), content.clone(), now));

                log::info!(
                    "[consumer] ingested {}: \"{}\" ({} chunks)",
                    trigger_type,
                    title,
                    resp.chunks_created
                );
            }
            Err(e) => {
                log::warn!("[consumer] daemon ingest failed: {}", e);

                // Still store the bundle so it can be retried
                let mut s = state.write().await;
                s.last_context_bundle = Some(bundle);
            }
        }
    }

    log::info!("[consumer] stopped (channel closed)");
}

/// Extract fields needed for the ingest HTTP request from a ContextBundle.
fn extract_ingest_fields(
    bundle: &ContextBundle,
) -> (
    String,
    String,
    String,
    String,
    Option<String>,
    std::collections::HashMap<String, String>,
) {
    let source = match bundle.trigger_type {
        TriggerSource::Thought => "quick_thought",
        _ => "context",
    }
    .to_string();

    let source_id = format!("ctx_{}", bundle.timestamp.timestamp());

    let title = bundle
        .raw_text
        .as_deref()
        .map(|text| {
            let first_line = text.lines().next().unwrap_or("Quick Thought");
            if first_line.len() > 60 {
                format!("{}...", &first_line[..first_line.floor_char_boundary(60)])
            } else {
                first_line.to_string()
            }
        })
        .unwrap_or_else(|| "Quick Thought".to_string());

    let content = bundle.raw_text.clone().unwrap_or_default();

    let url = None;

    let metadata = std::collections::HashMap::new();

    (source, source_id, title, content, url, metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_hash_deterministic() {
        let text = "The quick brown fox jumps over the lazy dog";
        assert_eq!(content_hash(text), content_hash(text));
        assert_ne!(content_hash(text), content_hash("different text"));
    }

    #[test]
    fn test_window_key_unique() {
        let k1 = window_key("Safari", "Google");
        let k2 = window_key("Chrome", "Google");
        let k3 = window_key("Safari", "GitHub");
        assert_ne!(k1, k2);
        assert_ne!(k1, k3);
        assert_ne!(k2, k3);
        assert_eq!(k1, window_key("Safari", "Google"));
    }

    #[test]
    fn test_text_similarity_identical() {
        assert!((text_similarity("hello world", "hello world") - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_text_similarity_completely_different() {
        let sim = text_similarity("abcdef", "xyz123");
        assert!(sim < 0.1, "expected <0.1, got {}", sim);
    }

    #[test]
    fn test_text_similarity_minor_ocr_noise() {
        // Simulates OCR noise: "Daylight Savi..." vs "8ight Savi..."
        let base = "The quick brown fox jumps over the lazy dog. This is a test of the OCR capture system.";
        let noisy = "The quick brown fox jumps over the lazy dog. This is a test of the OCR capture systen.";
        let sim = text_similarity(base, noisy);
        assert!(
            sim >= 0.85,
            "OCR noise should be above threshold, got {}",
            sim
        );
    }

    #[test]
    fn test_text_similarity_different_content() {
        let vscode = "fn main() { println!(\"hello\"); } // Rust code in VS Code editor with syntax highlighting";
        let chrome = "Google Search - Chrome browser tab showing search results for Rust programming language";
        let sim = text_similarity(vscode, chrome);
        assert!(
            sim < 0.85,
            "different content should be below threshold, got {}",
            sim
        );
    }
}
