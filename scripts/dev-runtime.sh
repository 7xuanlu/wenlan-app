#!/usr/bin/env bash
set -euo pipefail

to_shell_path() {
  local path="$1"
  if [[ "$path" =~ ^[A-Za-z]:[\\/].* ]]; then
    if ! command -v cygpath >/dev/null 2>&1; then
      echo "error: Windows path requires Git for Windows cygpath: $path" >&2
      return 1
    fi
    cygpath -u "$path"
  else
    printf '%s\n' "$path"
  fi
}

is_windows_shell() {
  case "${OSTYPE:-}" in
    msys* | cygwin* | win32*) return 0 ;;
    *) return 1 ;;
  esac
}

windows_executable_suffix() {
  if is_windows_shell; then
    printf '.exe\n'
  else
    printf '\n'
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_ID="$(printf '%s' "$REPO_ROOT" | cksum | awk '{ print $1 }')"
TMP_BASE="$(to_shell_path "${TMPDIR:-/tmp/}")"
STATE_DIR="$(to_shell_path "${WENLAN_DEV_STATE_DIR:-${TMP_BASE%/}/wenlan-app-dev/$WORKTREE_ID}")"
DEV_PORT="${WENLAN_DEV_PORT:-$((17000 + WORKTREE_ID % 1000))}"
DEV_UI_PORT="${WENLAN_DEV_UI_PORT:-$((18000 + WORKTREE_ID % 1000))}"
DEV_REMOTE_PORT_START="${WENLAN_DEV_REMOTE_PORT_START:-$((20000 + (WORKTREE_ID % 1000) * 4))}"
DEV_APP_ID="${WENLAN_DEV_APP_ID:-com.wenlan.desktop.dev.$WORKTREE_ID}"
DEV_DATA_DIR="$(to_shell_path "${WENLAN_DEV_DATA_DIR:-$STATE_DIR/data}")"
DEV_TAURI_MCP_SOCKET="$(to_shell_path "${WENLAN_DEV_TAURI_MCP_SOCKET:-$STATE_DIR/tauri-mcp.sock}")"
STARTED_RUNTIME=0

canonicalize_path() {
  local path resolved suffix=""
  path="$(to_shell_path "$1")"
  if [[ "$path" != /* ]]; then
    path="$PWD/$path"
  fi
  if resolved="$(realpath -m "$path" 2>/dev/null)"; then
    if is_windows_shell; then
      cygpath -m "$resolved"
    else
      printf '%s\n' "$resolved"
    fi
    return
  fi
  while [[ ! -e "$path" && "$path" != "/" ]]; do
    suffix="/$(basename "$path")$suffix"
    path="$(dirname "$path")"
  done
  resolved="$(realpath "$path")$suffix"
  if is_windows_shell; then
    cygpath -m "$resolved"
  else
    printf '%s\n' "$resolved"
  fi
}

STATE_DIR="$(canonicalize_path "$STATE_DIR")"
DEV_DATA_DIR="$(canonicalize_path "$DEV_DATA_DIR")"
DEV_TAURI_MCP_SOCKET="$(canonicalize_path "$DEV_TAURI_MCP_SOCKET")"
PID_FILE="$STATE_DIR/wenlan-server.pid"
SERVER_PATH_FILE="$STATE_DIR/wenlan-server.path"
PORT_FILE="$STATE_DIR/wenlan-server.port"
DATA_DIR_FILE="$STATE_DIR/wenlan-server.data-dir"
SERVER_LOG="$STATE_DIR/wenlan-server.log"
LOCK_DIR="$STATE_DIR/runtime.lock"
LOCK_OWNER_FILE="$LOCK_DIR/pid"
PRODUCTION_TAURI_MCP_SOCKET="$(canonicalize_path "/tmp/tauri-mcp.sock")"
PRODUCTION_PATH_ROOTS=()
for root in \
  "$HOME/Library/Application Support/wenlan" \
  "$HOME/Library/Application Support/origin" \
  "$HOME/Library/LaunchAgents" \
  "$HOME/Library/Logs/com.wenlan.desktop" \
  "$HOME/Library/Logs/com.origin.desktop" \
  "$HOME/.config/wenlan-mcp" \
  "$HOME/.config/origin-mcp" \
  "$HOME/.wenlan" \
  "$HOME/.origin"; do
  PRODUCTION_PATH_ROOTS+=("$(canonicalize_path "$root")")
done

path_is_within() {
  [[ "$1" == "$2" || "$1" == "$2/"* ]]
}

refuse_production_path() {
  local label="$1" value="$2" canonical root
  canonical="$(canonicalize_path "$value")"
  for root in "${PRODUCTION_PATH_ROOTS[@]}"; do
    if path_is_within "$canonical" "$root"; then
      echo "error: refusing production path for $label: $value" >&2
      exit 2
    fi
  done
}

if [[ ! "$DEV_PORT" =~ ^[0-9]+$ ]] || (( DEV_PORT < 1 || DEV_PORT > 65535 )); then
  echo "error: invalid WENLAN_DEV_PORT: $DEV_PORT" >&2
  exit 2
fi
if [[ ! "$DEV_UI_PORT" =~ ^[0-9]+$ ]] || (( DEV_UI_PORT < 1 || DEV_UI_PORT > 65535 )); then
  echo "error: invalid WENLAN_DEV_UI_PORT: $DEV_UI_PORT" >&2
  exit 2
fi
if [[ ! "$DEV_REMOTE_PORT_START" =~ ^[0-9]+$ ]] ||
  (( DEV_REMOTE_PORT_START < 1 || DEV_REMOTE_PORT_START > 65532 )); then
  echo "error: invalid WENLAN_DEV_REMOTE_PORT_START: $DEV_REMOTE_PORT_START" >&2
  exit 2
fi
if (( DEV_PORT == 7878 )); then
  echo "error: refusing production daemon port 7878" >&2
  exit 2
fi
if (( DEV_UI_PORT == 1420 )); then
  echo "error: refusing production UI identity on port 1420" >&2
  exit 2
fi
if (( DEV_REMOTE_PORT_START <= 18083 && DEV_REMOTE_PORT_START + 3 >= 18080 )); then
  echo "error: refusing production remote-access port range 18080-18083" >&2
  exit 2
fi
if [[ "$DEV_APP_ID" == "com.wenlan.desktop" || "$DEV_APP_ID" == "com.origin.desktop" ]]; then
  echo "error: refusing production app identifier: $DEV_APP_ID" >&2
  exit 2
fi
if [[ "$DEV_TAURI_MCP_SOCKET" == "$PRODUCTION_TAURI_MCP_SOCKET" ]]; then
  echo "error: refusing production Tauri MCP socket: $DEV_TAURI_MCP_SOCKET" >&2
  exit 2
fi
refuse_production_path "WENLAN_DEV_STATE_DIR" "$STATE_DIR"
refuse_production_path "WENLAN_DEV_DATA_DIR" "$DEV_DATA_DIR"
refuse_production_path "WENLAN_DEV_TAURI_MCP_SOCKET" "$DEV_TAURI_MCP_SOCKET"

print_config() {
  printf 'WENLAN_PORT=%s\n' "$DEV_PORT"
  printf 'WENLAN_DEV_UI_PORT=%s\n' "$DEV_UI_PORT"
  printf 'WENLAN_DEV_REMOTE_PORT_START=%s\n' "$DEV_REMOTE_PORT_START"
  printf 'WENLAN_DEV_APP_ID=%s\n' "$DEV_APP_ID"
  printf 'WENLAN_DEV_TAURI_MCP_SOCKET=%s\n' "$DEV_TAURI_MCP_SOCKET"
  printf 'WENLAN_DATA_DIR=%s\n' "$DEV_DATA_DIR"
  printf 'WENLAN_DEV_STATE_DIR=%s\n' "$STATE_DIR"
}

read_owned_pid() {
  [[ -f "$PID_FILE" && -f "$SERVER_PATH_FILE" && -f "$PORT_FILE" ]] || return 1
  OWNED_PID="$(sed -n '1p' "$PID_FILE")"
  OWNED_SERVER="$(sed -n '1p' "$SERVER_PATH_FILE")"
  OWNED_PORT="$(sed -n '1p' "$PORT_FILE")"
  OWNED_DATA_DIR="$(sed -n '1p' "$DATA_DIR_FILE" 2>/dev/null || true)"
  [[ "$OWNED_PID" =~ ^[0-9]+$ && -n "$OWNED_SERVER" &&
    "$OWNED_PORT" =~ ^[0-9]+$ ]] || return 1
  OWNED_SERVER="$(canonicalize_path "$OWNED_SERVER")"
  if [[ -n "$OWNED_DATA_DIR" ]]; then
    OWNED_DATA_DIR="$(canonicalize_path "$OWNED_DATA_DIR")"
  fi
}

listener_pid_for_port() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | sed -n '1p'
  elif is_windows_shell; then
    powershell.exe -NoLogo -NoProfile -NonInteractive -Command \
      "\$listener = Get-NetTCPConnection -State Listen -LocalPort $1 -ErrorAction SilentlyContinue | Select-Object -First 1; if (\$null -ne \$listener) { [Console]::Out.Write(\$listener.OwningProcess) }"
  fi
}

process_is_alive() {
  local pid="$1"
  if is_windows_shell; then
    powershell.exe -NoLogo -NoProfile -NonInteractive -Command \
      "if (Get-Process -Id $pid -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" \
      >/dev/null 2>&1
  else
    kill -0 "$pid" 2>/dev/null
  fi
}

process_executable_path() {
  local pid="$1"
  powershell.exe -NoLogo -NoProfile -NonInteractive -Command \
    "\$process = Get-Process -Id $pid -ErrorAction SilentlyContinue; if (\$null -eq \$process) { exit 1 }; [Console]::Out.Write(\$process.Path)"
}

terminate_process() {
  local pid="$1" force="${2:-false}"
  if is_windows_shell; then
    local args=(/PID "$pid" /T)
    if [[ "$force" == "true" ]]; then
      args+=(/F)
    fi
    taskkill.exe "${args[@]}" >/dev/null 2>&1
  elif [[ "$force" == "true" ]]; then
    kill -KILL "$pid"
  else
    kill "$pid"
  fi
}

has_owned_command_identity() {
  local command live_executable
  process_is_alive "$OWNED_PID" || return 1
  if is_windows_shell; then
    live_executable="$(process_executable_path "$OWNED_PID" 2>/dev/null || true)"
    [[ -n "$live_executable" ]] || return 1
    [[ "$(canonicalize_path "$live_executable")" == "$(canonicalize_path "$OWNED_SERVER")" ]]
    return
  fi
  command="$(ps -p "$OWNED_PID" -o command= 2>/dev/null || true)"
  [[ "$command" == "$OWNED_SERVER" || "$command" == "$OWNED_SERVER "* ]]
}

is_owned_process() {
  has_owned_command_identity &&
    [[ "$(listener_pid_for_port "$OWNED_PORT")" == "$OWNED_PID" ]]
}

release_runtime_lock() {
  if [[ -f "$LOCK_OWNER_FILE" ]] && [[ "$(sed -n '1p' "$LOCK_OWNER_FILE")" == "$$" ]]; then
    rm -f "$LOCK_OWNER_FILE"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_runtime_lock() {
  local owner
  mkdir -p "$STATE_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    owner="$(sed -n '1p' "$LOCK_OWNER_FILE" 2>/dev/null || true)"
    if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null; then
      echo "error: another dev runtime command is active (PID $owner)" >&2
      return 1
    fi
    rm -f "$LOCK_OWNER_FILE"
    rmdir "$LOCK_DIR" 2>/dev/null || {
      echo "error: stale dev runtime lock could not be recovered: $LOCK_DIR" >&2
      return 1
    }
    mkdir "$LOCK_DIR"
  fi
  printf '%s\n' "$$" >"$LOCK_OWNER_FILE"
  trap release_runtime_lock EXIT HUP INT TERM
}

stop_runtime() {
  if ! read_owned_pid; then
    echo "No worktree-owned Wenlan dev daemon is recorded."
    return 0
  fi
  if ! process_is_alive "$OWNED_PID"; then
    rm -f "$PID_FILE" "$SERVER_PATH_FILE" "$PORT_FILE" "$DATA_DIR_FILE"
    echo "Removed stale Wenlan dev daemon state."
    return 0
  fi
  if ! is_owned_process; then
    echo "error: refusing to stop PID $OWNED_PID because it is not $OWNED_SERVER" >&2
    return 1
  fi

  terminate_process "$OWNED_PID" false
  for _ in $(seq 1 50); do
    if ! process_is_alive "$OWNED_PID"; then
      rm -f "$PID_FILE" "$SERVER_PATH_FILE" "$PORT_FILE" "$DATA_DIR_FILE"
      echo "Stopped worktree-owned Wenlan dev daemon (PID $OWNED_PID)."
      return 0
    fi
    sleep 0.1
  done

  if has_owned_command_identity; then
    terminate_process "$OWNED_PID" true
  fi
  for _ in $(seq 1 50); do
    if ! process_is_alive "$OWNED_PID"; then
      rm -f "$PID_FILE" "$SERVER_PATH_FILE" "$PORT_FILE" "$DATA_DIR_FILE"
      echo "Force-stopped unresponsive worktree-owned Wenlan dev daemon (PID $OWNED_PID)."
      return 0
    fi
    sleep 0.1
  done
  echo "error: worktree-owned Wenlan dev daemon PID $OWNED_PID did not exit" >&2
  return 1
}

start_runtime() {
  local backend server pid listener_pid
  STARTED_RUNTIME=0
  DEV_DATA_DIR="$(canonicalize_path "$DEV_DATA_DIR")"
  backend="$(bash "$SCRIPT_DIR/resolve-backend-dir.sh" "$REPO_ROOT")"
  server="$(canonicalize_path "$backend/target/debug/wenlan-server$(windows_executable_suffix)")"

  if read_owned_pid && is_owned_process; then
    if [[ "$OWNED_SERVER" != "$server" || "$OWNED_PORT" != "$DEV_PORT" ||
      "$OWNED_DATA_DIR" != "$DEV_DATA_DIR" ]]; then
      echo "error: recorded dev daemon identity does not match this runtime configuration" >&2
      echo "recorded: server=$OWNED_SERVER port=$OWNED_PORT data=$OWNED_DATA_DIR" >&2
      echo "selected: server=$server port=$DEV_PORT data=$DEV_DATA_DIR" >&2
      return 1
    fi
    print_config
    echo "Wenlan dev daemon is already running (PID $OWNED_PID)."
    return 0
  fi

  mkdir -p "$STATE_DIR" "$DEV_DATA_DIR"
  rm -f "$PID_FILE" "$SERVER_PATH_FILE" "$PORT_FILE" "$DATA_DIR_FILE"

  if [[ -n "$(listener_pid_for_port "$DEV_PORT")" ]]; then
    echo "error: isolated dev port $DEV_PORT is already in use; set WENLAN_DEV_PORT" >&2
    return 1
  fi

  cargo build --manifest-path "$backend/Cargo.toml" -p wenlan-server
  nohup env WENLAN_PORT="$DEV_PORT" WENLAN_DATA_DIR="$DEV_DATA_DIR" \
    "$server" </dev/null >"$SERVER_LOG" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"
  printf '%s\n' "$server" >"$SERVER_PATH_FILE"
  printf '%s\n' "$DEV_PORT" >"$PORT_FILE"
  printf '%s\n' "$DEV_DATA_DIR" >"$DATA_DIR_FILE"

  for _ in $(seq 1 50); do
    if curl --fail --silent --max-time 1 \
      "http://127.0.0.1:$DEV_PORT/api/health" >/dev/null 2>&1; then
      listener_pid="$(listener_pid_for_port "$DEV_PORT")"
      if process_is_alive "$pid" && [[ "$listener_pid" == "$pid" ]]; then
        print_config
        echo "Started worktree-owned Wenlan dev daemon (PID $pid)."
        STARTED_RUNTIME=1
        return 0
      fi
      break
    fi
    if ! process_is_alive "$pid"; then
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
    acquire_runtime_lock
    start_runtime
    ;;
  start-for-session)
    acquire_runtime_lock
    start_runtime
    if (( STARTED_RUNTIME == 0 )); then
      exit 10
    fi
    ;;
  stop)
    acquire_runtime_lock
    stop_runtime
    ;;
  *)
    echo "usage: $0 {print-config|start|start-for-session|stop}" >&2
    exit 2
    ;;
esac
