#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Windows native-smoke flow: cloudflared first comes from the pinned release
# download, while backend executables come from one immutable source commit.
# Re-run the staging verifier in Tauri's build hook so beforeBuildCommand cannot
# silently replace or diverge from the already-built backend.
if [[ "${WENLAN_PRESTAGED_SIDECARS:-}" == "1" ]]; then
  exec node "$SCRIPT_DIR/windows/stage-backend-build.mjs" --verify-only
fi

# A source-build manifest is smoke-only evidence. If its owning flag vanished,
# downloading the release baseline here would silently replace the exact commit
# immediately before Tauri compiles. Fail closed instead.
if [[ -n "${WENLAN_SIDECAR_MANIFEST:-}" && -f "$WENLAN_SIDECAR_MANIFEST" ]]; then
  if ! manifest_backend_source="$(
    node -e '
      const fs = require("node:fs");
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8").replace(/^\uFEFF/, ""));
      process.stdout.write(String(manifest?.backend?.source || ""));
    ' "$WENLAN_SIDECAR_MANIFEST"
  )"; then
    echo "error: could not inspect existing sidecar manifest: $WENLAN_SIDECAR_MANIFEST" >&2
    exit 1
  fi
  if [[ "$manifest_backend_source" == "source-build" ]]; then
    echo "error: source-built sidecar manifest requires WENLAN_PRESTAGED_SIDECARS=1" >&2
    exit 1
  fi
fi

# Release/CI flow: daemon sidecars come from the pinned RELEASED asset
# (prepare-sidecars.sh --download), not a local backend compile. Tauri's
# beforeBuildCommand runs THIS wrapper, so the download must happen here -- else
# it falls through to the --release compile path and dies on the missing backend
# checkout. The release workflow sets WENLAN_DOWNLOAD_SIDECARS=1.
if [[ "${WENLAN_DOWNLOAD_SIDECARS:-}" == "1" ]]; then
  exec bash "$SCRIPT_DIR/prepare-sidecars.sh" --download
fi

if [[ "${TAURI_ENV_DEBUG:-}" == "true" ]]; then
  exec bash "$SCRIPT_DIR/prepare-sidecars.sh" "$@"
fi

exec bash "$SCRIPT_DIR/prepare-sidecars.sh" --release "$@"
