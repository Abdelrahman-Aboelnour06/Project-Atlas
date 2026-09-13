#!/bin/bash
# run_all_5.sh - Master runner for all 5 Project Atlas dimensions, test suites, or services.

set -e

MODE="${1:-all}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

if [ -f "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON="$BACKEND_DIR/venv/bin/python"
elif [ -f "$BACKEND_DIR/venv/Scripts/python.exe" ]; then
    PYTHON="$BACKEND_DIR/venv/Scripts/python.exe"
else
    PYTHON="python3"
fi

"$PYTHON" "$ROOT_DIR/run_all_5.py" --mode "$MODE"
