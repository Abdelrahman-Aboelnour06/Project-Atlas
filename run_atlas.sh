#!/usr/bin/env bash
#
# run_atlas.sh — bring up the whole Atlas stack locally.
#
# What this script DOES automate:
#   1. Postgres (via Docker, unless you already have one running)
#   2. Backend venv + pip install
#   3. Schema migration (001_init.sql) + demo API key seed
#   4. Backend server (uvicorn) in the background
#   5. Demo site static server in the background
#
# What it CANNOT automate (manual steps printed at the end):
#   - Loading the unpacked Chrome extension (chrome://extensions is a GUI-only flow)
#   - Getting/pasting an LLM_API_KEY from https://build.nvidia.com (or switching to Ollama)
#   - Pasting the demo API key into the extension's options page
#
# Usage:
#   ./run_atlas.sh          # start everything
#   ./run_atlas.sh stop     # stop backend + demo-site servers started by this script
#
# Run this from the repo root (the folder containing backend/, client-script/, demo-site/).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
DEMO_DIR="$ROOT_DIR/demo-site"
PID_DIR="$ROOT_DIR/.atlas-run"
BACKEND_PORT=8000
DEMO_PORT=5500
PG_CONTAINER=atlas-pg

mkdir -p "$PID_DIR"

log()  { printf "\033[1;36m[atlas]\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m[atlas]\033[0m %s\n" "$1"; }
err()  { printf "\033[1;31m[atlas]\033[0m %s\n" "$1" >&2; }

# ── stop mode ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  for name in backend demo-site; do
    pidfile="$PID_DIR/$name.pid"
    if [[ -f "$pidfile" ]]; then
      pid="$(cat "$pidfile")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && log "Stopped $name (pid $pid)"
      fi
      rm -f "$pidfile"
    fi
  done
  if command -v docker &>/dev/null && docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}\$"; then
    docker stop "$PG_CONTAINER" >/dev/null && log "Stopped Postgres container ($PG_CONTAINER)"
  fi
  log "Everything stopped."
  exit 0
fi

# ── sanity checks ─────────────────────────────────────────────────────────────
[[ -d "$BACKEND_DIR" ]] || { err "backend/ not found — run this from the repo root."; exit 1; }
[[ -d "$DEMO_DIR" ]]    || { err "demo-site/ not found — run this from the repo root."; exit 1; }

for cmd in python3 curl; do
  command -v "$cmd" &>/dev/null || { err "$cmd is required but not found on PATH."; exit 1; }
done

# ── 1. Postgres ───────────────────────────────────────────────────────────────
log "Checking Postgres..."
if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}\$"; then
    log "Postgres container '$PG_CONTAINER' already running."
  elif docker ps -a --format '{{.Names}}' | grep -q "^${PG_CONTAINER}\$"; then
    log "Starting existing Postgres container '$PG_CONTAINER'..."
    docker start "$PG_CONTAINER" >/dev/null
  else
    log "Creating Postgres container '$PG_CONTAINER'..."
    docker run --name "$PG_CONTAINER" \
      -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=atlas -e POSTGRES_DB=atlas_db \
      -p 5432:5432 -d postgres:16 >/dev/null
  fi
  log "Waiting for Postgres to accept connections..."
  for i in {1..30}; do
    if docker exec "$PG_CONTAINER" pg_isready -U atlas &>/dev/null; then
      log "Postgres is ready."
      break
    fi
    sleep 1
    [[ $i -eq 30 ]] && { err "Postgres didn't come up in time. Check: docker logs $PG_CONTAINER"; exit 1; }
  done
else
  warn "Docker not found. Assuming you already have Postgres running locally"
  warn "with a database/user matching backend/.env's DATABASE_URL. Continuing..."
fi

# ── 2. Backend venv + deps ────────────────────────────────────────────────────
cd "$BACKEND_DIR"

if [[ ! -d venv ]]; then
  log "Creating Python venv..."
  python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate

log "Installing backend dependencies (this can take a minute)..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

if [[ ! -f .env ]]; then
  log "No .env found — creating one from .env.example."
  cp .env.example .env
  warn "backend/.env was just created from the template."
  warn "You MUST edit it and set LLM_API_KEY (from https://build.nvidia.com),"
  warn "or switch LLM_PROVIDER to 'ollama' if you're running a local model."
  warn "Re-run this script after editing .env."
  exit 1
fi

# Make sure DATABASE_URL points at the local Postgres we just started
if grep -q '^LLM_API_KEY=\s*$' .env && ! grep -q '^LLM_PROVIDER=ollama' .env; then
  err "backend/.env has no LLM_API_KEY set and LLM_PROVIDER is not 'ollama'."
  err "The backend will refuse to start. Edit backend/.env, then re-run this script."
  exit 1
fi

# ── 3. Migration + seed ───────────────────────────────────────────────────────
DB_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
# postgresql+asyncpg://user:pass@host:port/db -> psql-friendly pieces
DB_USER="$(echo "$DB_URL" | sed -E 's#.*://([^:]+):.*#\1#')"
DB_NAME="$(echo "$DB_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
DB_HOST="$(echo "$DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')"

log "Applying schema migration (001_init.sql)..."
if command -v docker &>/dev/null && docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}\$"; then
  docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < app/migrations/001_init.sql
else
  PGPASSWORD=atlas psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f app/migrations/001_init.sql
fi

log "Seeding demo tenant + API key..."
python -m app.migrations.seed

# ── 4. Start backend server ───────────────────────────────────────────────────
if lsof -i ":$BACKEND_PORT" &>/dev/null; then
  warn "Something is already listening on port $BACKEND_PORT — assuming backend is up."
else
  log "Starting backend on http://localhost:$BACKEND_PORT ..."
  nohup uvicorn app.main:app --port "$BACKEND_PORT" \
    > "$PID_DIR/backend.log" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
  sleep 2
fi

log "Health-checking backend..."
for i in {1..15}; do
  if curl -sf "http://localhost:$BACKEND_PORT/health" >/dev/null; then
    log "Backend is healthy."
    break
  fi
  sleep 1
  [[ $i -eq 15 ]] && { err "Backend didn't come up. Check $PID_DIR/backend.log"; exit 1; }
done

# ── 5. Start demo-site server ─────────────────────────────────────────────────
cd "$DEMO_DIR"
if lsof -i ":$DEMO_PORT" &>/dev/null; then
  warn "Something is already listening on port $DEMO_PORT — assuming demo-site is up."
else
  log "Starting demo-site on http://localhost:$DEMO_PORT ..."
  nohup python3 -m http.server "$DEMO_PORT" \
    > "$PID_DIR/demo-site.log" 2>&1 &
  echo $! > "$PID_DIR/demo-site.pid"
fi

# ── done — print manual steps ─────────────────────────────────────────────────
cat <<EOF

──────────────────────────────────────────────────────────────────
 ✅ Backend  → http://localhost:$BACKEND_PORT  (docs at /docs)
 ✅ Demo site → http://localhost:$DEMO_PORT
──────────────────────────────────────────────────────────────────

Demo API key (already seeded): atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

Two things this script can't do for you — a few clicks in Chrome:

  1. Load the extension
     chrome://extensions → enable "Developer mode" (top right) →
     "Load unpacked" → select: $ROOT_DIR/client-script

  2. Activate + configure it
     Open http://localhost:$DEMO_PORT, click the Atlas toolbar icon.
     It'll open the options page automatically the first time —
     paste in the demo key above, confirm backend URL is
     http://localhost:$BACKEND_PORT, save, then click the icon again.

Optional — the tenant dashboard (mock data only, not required for the demo):
     cd $ROOT_DIR/dashboard && npm install && npm run dev
     → http://localhost:3000

To stop the backend + demo-site servers (and the Postgres container):
     $ROOT_DIR/run_atlas.sh stop

Logs: $PID_DIR/backend.log , $PID_DIR/demo-site.log
──────────────────────────────────────────────────────────────────
EOF
