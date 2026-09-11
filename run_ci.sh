#!/bin/bash
# run_ci.sh — Atlas CI/CD Pipeline Shell Runner
# Executes Unit, Module, and System tests.

set -e

STAGE="${1:-all}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
CLIENT_DIR="$ROOT_DIR/client-script"
DASHBOARD_DIR="$ROOT_DIR/dashboard"

if [ -f "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON="$BACKEND_DIR/venv/bin/python"
elif [ -f "$BACKEND_DIR/venv/Scripts/python.exe" ]; then
    PYTHON="$BACKEND_DIR/venv/Scripts/python.exe"
else
    PYTHON="python3"
fi

echo ""
echo "=========================================================="
echo "  Atlas CI/CD Pipeline — Stage: $STAGE"
echo "=========================================================="
echo ""

run_step() {
    local name="$1"
    shift
    echo ">>> [RUNNING] $name"
    "$@"
    echo ">>> [PASSED]  $name"
    echo ""
}

# 1. UNIT TESTING
if [ "$STAGE" = "all" ] || [ "$STAGE" = "unit" ]; then
    echo "── TIER 1: UNIT TESTS ──────────────────────────────────"
    run_step "Unit: Extension Script Syntax & Manifest Integrity" node "$CLIENT_DIR/test_extension.js"
    (cd "$BACKEND_DIR" && run_step "Unit: Backend Data Models" "$PYTHON" -m pytest tests/test_models.py -v --tb=short)
    (cd "$BACKEND_DIR" && run_step "Unit: Action & Simplify Parsers" "$PYTHON" -m pytest tests/test_action_parser.py -v --tb=short)
    (cd "$BACKEND_DIR" && run_step "Unit: Rate Limiter Logic" "$PYTHON" -m pytest tests/test_rate_limiter.py -v --tb=short)
fi

# 2. MODULE TESTING
if [ "$STAGE" = "all" ] || [ "$STAGE" = "module" ]; then
    echo "── TIER 2: MODULE TESTS ────────────────────────────────"
    (cd "$BACKEND_DIR" && run_step "Module: DB Utilities & Key Hashing" "$PYTHON" -m pytest tests/test_db_utils.py -v --tb=short)
    (cd "$BACKEND_DIR" && run_step "Module: REST API Endpoints & Handshake" "$PYTHON" -m pytest tests/test_routes_rest.py -v --tb=short)
    if [ -d "$DASHBOARD_DIR/node_modules" ]; then
        (cd "$DASHBOARD_DIR" && run_step "Module: Dashboard Build" npm run build)
    fi
fi

# 3. SYSTEM TESTING
if [ "$STAGE" = "all" ] || [ "$STAGE" = "system" ]; then
    echo "── TIER 3: SYSTEM TESTS ────────────────────────────────"
    (cd "$BACKEND_DIR" && run_step "System: WebSocket Agent Pipeline" "$PYTHON" -m pytest tests/test_websocket.py -v --tb=short)
    (cd "$BACKEND_DIR" && run_step "System: End-to-End Multi-Service Flow" "$PYTHON" -m pytest tests/test_system_e2e.py -v --tb=short)
fi

echo ""
echo "=========================================================="
echo "  ALL CI/CD PIPELINE STAGES PASSED SUCCESSFULLY"
echo "=========================================================="
echo ""
