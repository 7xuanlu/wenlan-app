// SPDX-License-Identifier: AGPL-3.0-only
use chrono::{DateTime, Utc};

/// Source classification for a context bundle. Replaces the previous
/// stringly-typed `trigger_type: String` field for compiler-checked match
/// arms across the router pipeline.
///
/// `Context` has no producer in the current code path — it is the historical
/// fallback string emitted by `extract_ingest_fields` for non-Thought bundles
/// (currently only `Hotkey`). Kept as a variant to preserve the legacy HTTP
/// `source = "context"` payload value for downstream consumers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerSource {
    Hotkey,
    Thought,
    Context,
}

impl TriggerSource {
    /// Stable string form for downstream HTTP payloads + log compatibility.
    pub fn as_str(&self) -> &'static str {
        match self {
            TriggerSource::Hotkey => "hotkey",
            TriggerSource::Thought => "thought",
            TriggerSource::Context => "context",
        }
    }
}

impl std::fmt::Display for TriggerSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A complete context capture bundle, ready for consumption.
#[derive(Debug, Clone)]
pub struct ContextBundle {
    pub trigger_type: TriggerSource,
    pub timestamp: DateTime<Utc>,
    pub raw_text: Option<String>,
}

impl ContextBundle {
    /// Create a bundle from a QuickThought text (bypasses vision).
    pub fn from_text(text: String) -> Self {
        Self {
            trigger_type: TriggerSource::Thought,
            timestamp: Utc::now(),
            raw_text: Some(text),
        }
    }
}

// bundle_to_raw_document was removed — its logic was inlined into
// run_context_consumer in router/intent.rs during the thin-client conversion
// (commit 42f74160), and the function is no longer called. Kept a note here
// so future readers don't go hunting for it.

#[cfg(test)]
mod tests {
    use super::*;

    /// Quick Capture's whole data path: the text the user types becomes a
    /// Thought bundle carrying that text verbatim. `run_router` hands
    /// `QuickThought` straight to `from_text`, so if this breaks, typing into
    /// Quick Capture silently stores nothing (or stores it as the wrong
    /// source) with no compile error to catch it.
    ///
    /// Written when the ambient-capture subsystem was deleted out from under
    /// this module: `from_text` had no test, and the deletion touched every
    /// other producer in the file.
    #[test]
    fn quick_thought_text_survives_bundling() {
        let bundle = ContextBundle::from_text("ship the connect redesign".to_string());

        assert_eq!(
            bundle.raw_text.as_deref(),
            Some("ship the connect redesign")
        );
        assert_eq!(bundle.trigger_type, TriggerSource::Thought);
        // The daemon keys ingestion off this string; "thought" is the wire value.
        assert_eq!(bundle.trigger_type.as_str(), "thought");
    }
}
