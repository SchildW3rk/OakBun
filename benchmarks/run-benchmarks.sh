#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OakBun vs Hono — Benchmark Runner
#
# Usage:  ./run-benchmarks.sh
#
# Requires: bun, oha  (brew install oha)  — falls back to wrk if oha missing.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

OAKBUN_PORT=3000
HONO_PORT=3001
DURATION="${DURATION:-10s}"
CONCURRENCY="${CONCURRENCY:-100}"
WARMUP_SECS="${WARMUP_SECS:-2}"

# ── Tool detection ───────────────────────────────────────────────────────────
LOADER=""
if command -v oha >/dev/null 2>&1; then
  LOADER="oha"
elif command -v wrk >/dev/null 2>&1; then
  LOADER="wrk"
else
  echo "ERROR: neither 'oha' nor 'wrk' found in PATH." >&2
  echo "Install with:  brew install oha    (recommended)" >&2
  echo "           or  brew install wrk" >&2
  exit 1
fi

echo "─────────────────────────────────────────────────────────────────"
echo " OakBun vs Hono — Benchmark"
echo "  loader:       $LOADER"
echo "  concurrency:  $CONCURRENCY"
echo "  duration:     $DURATION"
echo "  warmup:       ${WARMUP_SECS}s"
echo "─────────────────────────────────────────────────────────────────"

# ── Helpers ──────────────────────────────────────────────────────────────────
OAKBUN_PID=""
HONO_PID=""

cleanup() {
  set +e
  if [[ -n "$OAKBUN_PID" ]]; then kill "$OAKBUN_PID" 2>/dev/null; fi
  if [[ -n "$HONO_PID"   ]]; then kill "$HONO_PID"   2>/dev/null; fi
  # also make sure nothing is left holding the ports
  lsof -ti tcp:"$OAKBUN_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  lsof -ti tcp:"$HONO_PORT"   2>/dev/null | xargs -r kill -9 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_ready() {
  local url="$1"
  local tries=50
  while (( tries-- > 0 )); do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 0.1
  done
  echo "ERROR: server at $url did not become ready" >&2
  return 1
}

run_load() {
  local label="$1"
  local url="$2"
  echo ""
  echo "── $label ───────────────────────────────────────────────────────"
  echo "    $url"
  # Warmup (discard output).
  if [[ "$LOADER" == "oha" ]]; then
    oha --no-tui -c "$CONCURRENCY" -z "${WARMUP_SECS}s" "$url" >/dev/null 2>&1 || true
    oha --no-tui -c "$CONCURRENCY" -z "$DURATION"  "$url"
  else
    wrk -c "$CONCURRENCY" -t 4 -d "${WARMUP_SECS}s" "$url" >/dev/null 2>&1 || true
    wrk -c "$CONCURRENCY" -t 4 -d "$DURATION"  "$url"
  fi
}

# ── Free ports before starting ───────────────────────────────────────────────
lsof -ti tcp:"$OAKBUN_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
lsof -ti tcp:"$HONO_PORT"   2>/dev/null | xargs -r kill -9 2>/dev/null || true

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  OakBun                                                                   ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
echo ""
echo "▶ Starting OakBun (port $OAKBUN_PORT)…"
PORT="$OAKBUN_PORT" bun oakbun-server.ts > oakbun.log 2>&1 &
OAKBUN_PID=$!
wait_ready "http://localhost:$OAKBUN_PORT/health"

run_load "OakBun — GET /health (baseline)"            "http://localhost:$OAKBUN_PORT/health"
run_load "OakBun — GET /api/users/:id (real-world)"   "http://localhost:$OAKBUN_PORT/api/users/123"

kill "$OAKBUN_PID" 2>/dev/null || true
wait "$OAKBUN_PID" 2>/dev/null || true
OAKBUN_PID=""

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  Hono                                                                     ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
echo ""
echo "▶ Starting Hono (port $HONO_PORT)…"
PORT="$HONO_PORT" bun hono-server.ts > hono.log 2>&1 &
HONO_PID=$!
wait_ready "http://localhost:$HONO_PORT/health"

run_load "Hono — GET /health (baseline)"              "http://localhost:$HONO_PORT/health"
run_load "Hono — GET /api/users/:id (real-world)"     "http://localhost:$HONO_PORT/api/users/123"

kill "$HONO_PID" 2>/dev/null || true
wait "$HONO_PID" 2>/dev/null || true
HONO_PID=""

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo " Done. Server logs: oakbun.log, hono.log"
echo "─────────────────────────────────────────────────────────────────"
