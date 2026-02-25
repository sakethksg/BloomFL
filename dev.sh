#!/usr/bin/env bash
# dev.sh — Start the BloomFL dashboard API and frontend in development mode.
# Usage: bash dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "→ Starting FastAPI backend on http://localhost:8000"
cd "$ROOT"
"$ROOT/venv/bin/uvicorn" api.main:app \
  --reload \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info &
API_PID=$!

echo "→ Starting Next.js frontend on http://localhost:3000"
cd "$ROOT/frontend"
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev &
FRONTEND_PID=$!

echo ""
echo "  API:      http://localhost:8000"
echo "  Docs:     http://localhost:8000/docs"
echo "  Frontend: http://localhost:3000"
echo ""
echo "  Press Ctrl-C to stop both services."

cleanup() {
  echo ""
  echo "→ Stopping services…"
  kill "$API_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup INT TERM

wait
