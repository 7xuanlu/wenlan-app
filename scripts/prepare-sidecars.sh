#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="${WENLAN_BACKEND_DIR:-../..}"

if [[ "$BACKEND_DIR" != /* ]]; then
  BACKEND_DIR="$REPO_ROOT/$BACKEND_DIR"
fi
BACKEND_DIR="$(cd "$BACKEND_DIR" && pwd)"

PROFILE="debug"
FORCE_BUILD=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      PROFILE="release"
      ;;
    --force-build)
      FORCE_BUILD=true
      ;;
    *)
      echo "usage: $0 [--release] [--force-build]" >&2
      exit 2
      ;;
  esac
  shift
done

TRIPLE="${TARGET_TRIPLE:-$(rustc -vV | awk '/^host:/ { print $2 }')}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$BACKEND_DIR/target}"
SERVER_SRC="$CARGO_TARGET_DIR/$PROFILE/wenlan-server"
MCP_SRC="$CARGO_TARGET_DIR/$PROFILE/wenlan-mcp"

if [[ "$FORCE_BUILD" == "true" || ! -x "$SERVER_SRC" || ! -x "$MCP_SRC" ]]; then
  if [[ "$PROFILE" == "release" ]]; then
    cargo build --manifest-path "$BACKEND_DIR/Cargo.toml" --release -p wenlan-server -p wenlan-mcp
  else
    cargo build --manifest-path "$BACKEND_DIR/Cargo.toml" -p wenlan-server -p wenlan-mcp
  fi
else
  echo "Using existing backend sidecars from $CARGO_TARGET_DIR/$PROFILE"
fi

BIN_DIR="$REPO_ROOT/app/binaries"
mkdir -p "$BIN_DIR"

install -m 755 "$SERVER_SRC" "$BIN_DIR/wenlan-server-$TRIPLE"
install -m 755 "$MCP_SRC" "$BIN_DIR/wenlan-mcp-$TRIPLE"

if command -v cloudflared >/dev/null 2>&1; then
  install -m 755 "$(command -v cloudflared)" "$BIN_DIR/cloudflared-$TRIPLE"
else
  echo "warning: cloudflared not found in PATH; raw Tauri builds may still fail on binaries/cloudflared-$TRIPLE" >&2
fi

echo "Prepared sidecars in $BIN_DIR for $TRIPLE"
