#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8765}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
API_BASE="${NEXT_PUBLIC_API_BASE:-http://localhost:${BACKEND_PORT}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  if [ -n "$BACKEND_PID" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [ -n "$FRONTEND_PID" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  if [ -n "$BACKEND_PID" ]; then wait "$BACKEND_PID" 2>/dev/null || true; fi
  if [ -n "$FRONTEND_PID" ]; then wait "$FRONTEND_PID" 2>/dev/null || true; fi
  echo "Stopped."
}
trap cleanup EXIT INT TERM

free_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -ti:"$port" >/dev/null 2>&1; then
    echo -e "${YELLOW}Port $port is already in use. Trying to free it...${NC}"
    lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

resolve_python() {
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c \
      'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

echo "=== Marventa AI ==="

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}[frontend] npm not found in PATH.${NC}"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}[frontend] node not found in PATH.${NC}"
  exit 1
fi

PYTHON_BIN="$(resolve_python)"
if [ -z "$PYTHON_BIN" ]; then
  echo -e "${RED}[backend] Python 3.11+ not found in PATH.${NC}"
  exit 1
fi

free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
  echo -e "${YELLOW}[backend] Creating virtual environment...${NC}"
  "$PYTHON_BIN" -m venv .venv
fi

source .venv/bin/activate
echo "[backend] Installing dependencies..."
python -m pip install --disable-pip-version-check -r requirements.txt
echo "[backend] Installing Playwright Chromium..."
python -m playwright install chromium

echo "[backend] Starting FastAPI on port $BACKEND_PORT..."
python -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" &
BACKEND_PID=$!

sleep 2
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo -e "${RED}[backend] Failed to start.${NC}"
  exit 1
fi
echo -e "[backend] ${GREEN}Running${NC} (pid $BACKEND_PID)"

cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}[frontend] Installing dependencies...${NC}"
  npm ci
fi

echo "[frontend] Starting Next.js on port $FRONTEND_PORT..."
NEXT_PUBLIC_API_BASE="$API_BASE" npm run dev -- --webpack --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

sleep 3
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  echo -e "${RED}[frontend] Failed to start.${NC}"
  exit 1
fi
echo -e "[frontend] ${GREEN}Running${NC} (pid $FRONTEND_PID)"

echo ""
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "Backend:  http://localhost:$BACKEND_PORT"
echo "API docs: http://localhost:$BACKEND_PORT/docs"
echo ""
echo "Press Ctrl+C to stop all."

wait
