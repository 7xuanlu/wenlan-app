#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_ID="$(printf '%s' "$REPO_ROOT" | cksum | awk '{ print $1 }')"
TMP_BASE="${TMPDIR:-/tmp/}"
STATE_DIR="${WENLAN_DEV_STATE_DIR:-${TMP_BASE%/}/wenlan-app-dev/$WORKTREE_ID}"
DEV_PORT="${WENLAN_DEV_PORT:-$((17000 + WORKTREE_ID % 1000))}"
DEV_UI_PORT="${WENLAN_DEV_UI_PORT:-$((18000 + WORKTREE_ID % 1000))}"
DEV_APP_ID="${WENLAN_DEV_APP_ID:-com.wenlan.desktop.dev.$WORKTREE_ID}"
DEV_DATA_DIR="${WENLAN_DEV_DATA_DIR:-$STATE_DIR/data}"
DEV_TAURI_MCP_SOCKET="${WENLAN_DEV_TAURI_MCP_SOCKET:-$STATE_DIR/tauri-mcp.sock}"
PID_FILE="$STATE_DIR/wenlan-server.pid"
SERVER_PATH_FILE="$STATE_DIR/wenlan-server.path"
SERVER_LOG="$STATE_DIR/wenlan-server.log"
STARTED_RUNTIME=0

if [[ ! "$DEV_PORT" =~ ^[0-9]+$ ]] || (( DEV_PORT < 1 || DEV_PORT > 65535 )); then
  echo "error: invalid WENLAN_DEV_PORT: $DEV_PORT" >&2
  exit 2
fi
if [[ ! "$DEV_UI_PORT" =~ ^[0-9]+$ ]] || (( DEV_UI_PORT < 1 || DEV_UI_PORT > 65535 )); then
  echo "error: invalid WENLAN_DEV_UI_PORT: $DEV_UI_PORT" >&2
  exit 2
fi

print_config() {
  printf 'WENLAN_PORT=%s\n' "$DEV_PORT"
  printf 'WENLAN_DEV_UI_PORT=%s\n' "$DEV_UI_PORT"
  printf 'WENLAN_DEV_APP_ID=%s\n' "$DEV_APP_ID"
  printf 'WENLAN_DEV_TAURI_MCP_SOCKET=%s\n' "$DEV_TAURI_MCP_SOCKET"
  printf 'WENLAN_DATA_DIR=%s\n' "$DEV_DATA_DIR"
  printf 'WENLAN_DEV_STATE_DIR=%s\n' "$STATE_DIR"
}

read_owned_pid() {
  [[ -f "$PID_FILE" && -f "$SERVER_PATH_FILE" ]] || return 1
  OWNED_PID="$(sed -n '1p' "$PID_FILE")"
  OWNED_SERVER="$(sed -n '1p' "$SERVER_PATH_FILE")"
  [[ "$OWNED_PID" =~ ^[0-9]+$ && -n "$OWNED_SERVER" ]] || return 1
}

is_owned_process() {
  local command
  kill -0 "$OWNED_PID" 2>/dev/null || return 1
  command="$(ps -p "$OWNED_PID" -o command= 2>/dev/null || true)"
  [[ "$command" == "$OWNED_SERVER" || "$command" == "$OWNED_SERVER "* ]]
}

stop_runtime() {
  if ! read_owned_pid; then
    echo "No worktree-owned Wenlan dev daemon is recorded."
    return 0
  fi
  if ! kill -0 "$OWNED_PID" 2>/dev/null; then
    rm -f "$PID_FILE" "$SERVER_PATH_FILE"
    echo "Removed stale Wenlan dev daemon state."
    return 0
  fi
  if ! is_owned_process; then
    echo "error: refusing to stop PID $OWNED_PID because it is not $OWNED_SERVER" >&2
    return 1
  fi

  kill "$OWNED_PID"
  for _ in $(seq 1 50); do
    if ! kill -0 "$OWNED_PID" 2>/dev/null; then
      rm -f "$PID_FILE" "$SERVER_PATH_FILE"
      echo "Stopped worktree-owned Wenlan dev daemon (PID $OWNED_PID)."
      return 0
    fi
    sleep 0.1
  done

  if is_owned_process; then
    kill -KILL "$OWNED_PID"
  fi
  rm -f "$PID_FILE" "$SERVER_PATH_FILE"
  echo "Force-stopped unresponsive worktree-owned Wenlan dev daemon (PID $OWNED_PID)."
}

start_runtime() {
  local backend server pid
  STARTED_RUNTIME=0
  backend="$(bash "$SCRIPT_DIR/resolve-backend-dir.sh" "$REPO_ROOT")"
  server="$backend/target/debug/wenlan-server"

  if read_owned_pid && is_owned_process; then
    print_config
    echo "Wenlan dev daemon is already running (PID $OWNED_PID)."
    return 0
  fi

  mkdir -p "$STATE_DIR" "$DEV_DATA_DIR"
  rm -f "$PID_FILE" "$SERVER_PATH_FILE"

  if lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "error: isolated dev port $DEV_PORT is already in use; set WENLAN_DEV_PORT" >&2
    return 1
  fi

  cargo build --manifest-path "$backend/Cargo.toml" -p wenlan-server
  nohup env WENLAN_PORT="$DEV_PORT" WENLAN_DATA_DIR="$DEV_DATA_DIR" \
    "$server" </dev/null >"$SERVER_LOG" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"
  printf '%s\n' "$server" >"$SERVER_PATH_FILE"

  for _ in $(seq 1 50); do
    if curl --fail --silent --max-time 1 \
      "http://127.0.0.1:$DEV_PORT/api/health" >/dev/null 2>&1; then
      print_config
      echo "Started worktree-owned Wenlan dev daemon (PID $pid)."
      STARTED_RUNTIME=1
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  tail -n 40 "$SERVER_LOG" >&2 || true
  stop_runtime || true
  echo "error: Wenlan dev daemon did not become healthy on port $DEV_PORT" >&2
  return 1
}

case "${1:-}" in
  print-config)
    print_config
    ;;
  start)
    start_runtime
    ;;
  start-for-session)
    start_runtime
    if (( STARTED_RUNTIME == 0 )); then
      exit 10
    fi
    ;;
  stop)
    stop_runtime
    ;;
  *)
    echo "usage: $0 {print-config|start|start-for-session|stop}" >&2
    exit 2
    ;;
esac
