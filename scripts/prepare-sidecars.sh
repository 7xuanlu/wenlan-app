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
PRINT_PATHS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      PROFILE="release"
      ;;
    --force-build)
      FORCE_BUILD=true
      ;;
    --print-paths)
      PRINT_PATHS=true
      ;;
    *)
      echo "usage: $0 [--release] [--force-build] [--print-paths]" >&2
      exit 2
      ;;
  esac
  shift
done

HOST_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
TRIPLE="${TARGET_TRIPLE:-$HOST_TRIPLE}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$BACKEND_DIR/target}"
BIN_DIR="$REPO_ROOT/app/binaries"
if [[ -n "${TARGET_TRIPLE:-}" ]]; then
  SOURCE_DIR="$CARGO_TARGET_DIR/$TRIPLE/$PROFILE"
else
  SOURCE_DIR="$CARGO_TARGET_DIR/$PROFILE"
fi
case "$TRIPLE" in
  *windows*) EXE_SUFFIX=".exe" ;;
  *) EXE_SUFFIX="" ;;
esac
SERVER_SRC="$SOURCE_DIR/wenlan-server$EXE_SUFFIX"
MCP_SRC="$SOURCE_DIR/wenlan-mcp$EXE_SUFFIX"
SERVER_DEST="$BIN_DIR/wenlan-server-$TRIPLE$EXE_SUFFIX"
MCP_DEST="$BIN_DIR/wenlan-mcp-$TRIPLE$EXE_SUFFIX"
CLOUDFLARED_DEST="$BIN_DIR/cloudflared-$TRIPLE$EXE_SUFFIX"

if [[ "$PRINT_PATHS" == "true" ]]; then
  printf 'server_src=%s\n' "$SERVER_SRC"
  printf 'mcp_src=%s\n' "$MCP_SRC"
  printf 'server_dest=%s\n' "$SERVER_DEST"
  printf 'mcp_dest=%s\n' "$MCP_DEST"
  printf 'cloudflared_dest=%s\n' "$CLOUDFLARED_DEST"
  exit 0
fi

if [[ "$FORCE_BUILD" == "true" || ! -x "$SERVER_SRC" || ! -x "$MCP_SRC" ]]; then
  if [[ -n "${TARGET_TRIPLE:-}" && "$PROFILE" == "release" ]]; then
    cargo build --manifest-path "$BACKEND_DIR/Cargo.toml" --target "$TRIPLE" --release -p wenlan-server -p wenlan-mcp
  elif [[ -n "${TARGET_TRIPLE:-}" ]]; then
    cargo build --manifest-path "$BACKEND_DIR/Cargo.toml" --target "$TRIPLE" -p wenlan-server -p wenlan-mcp
  elif [[ "$PROFILE" == "release" ]]; then
    cargo build --manifest-path "$BACKEND_DIR/Cargo.toml" --release -p wenlan-server -p wenlan-mcp
  else
    cargo build --manifest-path "$BACKEND_DIR/Cargo.toml" -p wenlan-server -p wenlan-mcp
  fi
else
  echo "Using existing backend sidecars from $SOURCE_DIR"
fi

mkdir -p "$BIN_DIR"

install -m 755 "$SERVER_SRC" "$SERVER_DEST"
install -m 755 "$MCP_SRC" "$MCP_DEST"

if command -v cloudflared >/dev/null 2>&1; then
  install -m 755 "$(command -v cloudflared)" "$CLOUDFLARED_DEST"
else
  echo "warning: cloudflared not found in PATH; raw Tauri builds may still fail on binaries/cloudflared-$TRIPLE" >&2
fi

echo "Prepared sidecars in $BIN_DIR for $TRIPLE"
