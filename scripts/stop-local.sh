#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-8765}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

stop_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "Stopping processes on port $port: $pids"
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  else
    echo "lsof not found; cannot automatically stop port $port."
  fi
}

stop_port "$FRONTEND_PORT"
stop_port "$BACKEND_PORT"

echo "Stopped local services on ports $FRONTEND_PORT and $BACKEND_PORT."
