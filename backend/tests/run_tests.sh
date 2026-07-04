#!/bin/bash
# Atlas Backend Testbench
# Run from inside the backend/ folder:
#   bash tests/run_tests.sh

set -e

echo ""
echo "══════════════════════════════════════════"
echo "  Atlas Backend Testbench"
echo "══════════════════════════════════════════"
echo ""

# Install test deps if needed
pip install -r tests/requirements-test.txt -q

echo ""
echo "── Models ───────────────────────────────"
pytest tests/test_models.py -v

echo ""
echo "── DB Utilities ─────────────────────────"
pytest tests/test_db_utils.py -v

echo ""
echo "── Action Parser ────────────────────────"
pytest tests/test_action_parser.py -v

echo ""
echo "── REST Routes ──────────────────────────"
pytest tests/test_routes_rest.py -v

echo ""
echo "── WebSocket ────────────────────────────"
pytest tests/test_websocket.py -v

echo ""
echo "── Full Report ──────────────────────────"
pytest tests/ -v --tb=short

echo ""
echo "══════════════════════════════════════════"
echo "  Done"
echo "══════════════════════════════════════════"
