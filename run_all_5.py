#!/usr/bin/env python3
"""
run_all_5.py — Universal Project Atlas 5-Pillar Test, Audit & Service Runner

Supports:
  python run_all_5.py                  # Runs All 5 Audits & Test Pillars (default)
  python run_all_5.py --mode=audit     # Runs All 5 Specialized Audit Dimensions
  python run_all_5.py --mode=tests     # Runs All 5 Core Test Suites
  python run_all_5.py --mode=services  # Launches All 5 Runtime Services concurrently
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
CLIENT_DIR = ROOT_DIR / "client-script"
DASHBOARD_DIR = ROOT_DIR / "dashboard"
DEMO_DIR = ROOT_DIR / "demo-site"

VENV_PYTHON = BACKEND_DIR / "venv" / "Scripts" / "python.exe"
if not VENV_PYTHON.exists():
    VENV_PYTHON = BACKEND_DIR / "venv" / "bin" / "python"
if not VENV_PYTHON.exists():
    VENV_PYTHON = Path(sys.executable)

# ANSI Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"


def print_banner(text: str):
    print(f"\n{CYAN}======================================================================{RESET}")
    print(f"{CYAN}{BOLD}  {text}{RESET}")
    print(f"{CYAN}======================================================================{RESET}\n")


def run_command(name: str, cmd: list[str], cwd: Path | None = None) -> bool:
    print(f"{YELLOW}>>> [RUNNING] {name}{RESET}")
    start = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or ROOT_DIR),
            text=True,
            capture_output=True,
        )
        elapsed = time.time() - start
        if proc.returncode == 0:
            print(f"{GREEN}>>> [PASSED]  {name} ({elapsed:.2f}s){RESET}\n")
            return True
        else:
            print(f"{RED}>>> [FAILED]  {name} (Exit code: {proc.returncode}){RESET}")
            if proc.stdout:
                print(proc.stdout[-1500:])
            if proc.stderr:
                print(proc.stderr[-1500:])
            print()
            return False
    except Exception as exc:
        print(f"{RED}>>> [ERROR]   {name} - {exc}{RESET}\n")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# MODE 1: THE 5 SPECIALIZED AUDIT DIMENSIONS
# ─────────────────────────────────────────────────────────────────────────────
def run_all_5_audits() -> bool:
    print_banner("RUNNING ALL 5 SPECIALIZED AUDIT & SECURITY DIMENSIONS")

    pillars = [
        (
            "Pillar 1: Security, Auth Gates & Secret Detection",
            [str(VENV_PYTHON), "-m", "pytest", "tests/test_security_resilience.py", "tests/test_auth_and_transactions.py", "-q", "--tb=short"],
            BACKEND_DIR,
        ),
        (
            "Pillar 2: Performance, Concurrency & Reflow Bounds",
            [str(VENV_PYTHON), "-m", "pytest", "tests/test_rate_limiter.py", "-q", "--tb=short"],
            BACKEND_DIR,
        ),
        (
            "Pillar 3: Accessibility & Usability (WCAG AA & Touch Targets)",
            ["node", str(CLIENT_DIR / "test_extension.js")],
            ROOT_DIR,
        ),
        (
            "Pillar 4: Architecture, Prime Directive & Heuristics",
            [str(VENV_PYTHON), "-m", "pytest", "tests/test_models.py", "tests/test_action_parser.py", "-q", "--tb=short"],
            BACKEND_DIR,
        ),
        (
            "Pillar 5: System Integration & Full Pipeline End-to-End",
            [str(VENV_PYTHON), "-m", "pytest", "tests/test_websocket.py", "tests/test_system_e2e.py", "-q", "--tb=short"],
            BACKEND_DIR,
        ),
    ]

    all_ok = True
    for name, cmd, cwd in pillars:
        ok = run_command(name, cmd, cwd)
        if not ok:
            all_ok = False

    return all_ok


# ─────────────────────────────────────────────────────────────────────────────
# MODE 2: THE 5 CORE TEST SUITES
# ─────────────────────────────────────────────────────────────────────────────
def run_all_5_tests() -> bool:
    print_banner("RUNNING ALL 5 BACKEND & EXTENSION TEST SUITES")

    suites = [
        ("Suite 1: Data Models & PII Stripping", [str(VENV_PYTHON), "-m", "pytest", "tests/test_models.py", "-v", "--tb=short"], BACKEND_DIR),
        ("Suite 2: Parsers & Rate Limiting Logic", [str(VENV_PYTHON), "-m", "pytest", "tests/test_action_parser.py", "tests/test_rate_limiter.py", "-v", "--tb=short"], BACKEND_DIR),
        ("Suite 3: DB Transactions & Auth Security", [str(VENV_PYTHON), "-m", "pytest", "tests/test_db_utils.py", "tests/test_auth_and_transactions.py", "-v", "--tb=short"], BACKEND_DIR),
        ("Suite 4: REST Endpoints & Security Resilience", [str(VENV_PYTHON), "-m", "pytest", "tests/test_routes_rest.py", "tests/test_security_resilience.py", "-v", "--tb=short"], BACKEND_DIR),
        ("Suite 5: WebSocket Pipeline & Client Extension", [str(VENV_PYTHON), "-m", "pytest", "tests/test_websocket.py", "tests/test_system_e2e.py", "-v", "--tb=short"], BACKEND_DIR),
    ]

    all_ok = True
    for name, cmd, cwd in suites:
        ok = run_command(name, cmd, cwd)
        if not ok:
            all_ok = False

    return all_ok


# ─────────────────────────────────────────────────────────────────────────────
# MODE 3: THE 5 RUNTIME SERVICES
# ─────────────────────────────────────────────────────────────────────────────
def run_all_5_services():
    print_banner("LAUNCHING ALL 5 RUNTIME SERVICES & COMPONENTS")
    print(f"{CYAN}1. PostgreSQL Database      : localhost:5432 (or Docker container){RESET}")
    print(f"{CYAN}2. FastAPI Backend          : http://localhost:8000{RESET}")
    print(f"{CYAN}3. Next.js Dashboard UI     : http://localhost:3000{RESET}")
    print(f"{CYAN}4. Riverbend Market Demo    : http://localhost:5500{RESET}")
    print(f"{CYAN}5. Extension Test Runner    : client-script/test_extension.js{RESET}\n")

    processes = []

    try:
        # Service 2: FastAPI Backend Server
        print(f"{YELLOW}>>> Starting Service 2: FastAPI Backend (port 8000)...{RESET}")
        p_backend = subprocess.Popen(
            [str(VENV_PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"],
            cwd=str(BACKEND_DIR),
        )
        processes.append(("FastAPI Backend", p_backend))

        # Service 4: Demo Target Website
        print(f"{YELLOW}>>> Starting Service 4: Demo Target Website (port 5500)...{RESET}")
        p_demo = subprocess.Popen(
            [str(VENV_PYTHON), "-m", "http.server", "5500"],
            cwd=str(DEMO_DIR),
        )
        processes.append(("Demo Website", p_demo))

        # Service 3: Next.js Dashboard (if dependencies exist)
        if (DASHBOARD_DIR / "node_modules").exists():
            print(f"{YELLOW}>>> Starting Service 3: Next.js Dashboard (port 3000)...{RESET}")
            p_dash = subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=str(DASHBOARD_DIR),
                shell=(sys.platform == "win32"),
            )
            processes.append(("Next.js Dashboard", p_dash))
        else:
            print(f"{MAGENTA}--- [INFO] Service 3: Dashboard node_modules not found. Run 'npm install' in dashboard/ to enable.{RESET}")

        # Service 5: Run Extension verification
        print(f"{YELLOW}>>> Executing Service 5: Chrome Extension Quality Verification...{RESET}")
        run_command("Chrome Extension Verification", ["node", str(CLIENT_DIR / "test_extension.js")], ROOT_DIR)

        print(f"\n{GREEN}{BOLD}All available services are running! Press Ctrl+C to stop all services.{RESET}\n")
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Shutting down all services gracefully...{RESET}")
        for name, p in processes:
            print(f"Terminating {name}...")
            p.terminate()
        print(f"{GREEN}All services stopped.{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN DISPATCHER
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Atlas All-5 Runner")
    parser.add_argument(
        "--mode",
        choices=["audit", "tests", "services", "all"],
        default="all",
        help="Execution mode: 'audit' (5 audit dimensions), 'tests' (5 test suites), 'services' (5 runtime services), 'all' (audit + tests)",
    )
    args = parser.parse_args()

    if args.mode == "services":
        run_all_5_services()
        sys.exit(0)
    elif args.mode == "audit":
        success = run_all_5_audits()
    elif args.mode == "tests":
        success = run_all_5_tests()
    else:  # "all"
        ok_audit = run_all_5_audits()
        ok_tests = run_all_5_tests()
        success = ok_audit and ok_tests

    if success:
        print(f"{GREEN}{BOLD}======================================================================{RESET}")
        print(f"{GREEN}{BOLD}  SUCCESS: ALL 5 PILLARS COMPLETED WITH ZERO ERRORS{RESET}")
        print(f"{GREEN}{BOLD}======================================================================{RESET}\n")
        sys.exit(0)
    else:
        print(f"{RED}{BOLD}======================================================================{RESET}")
        print(f"{RED}{BOLD}  FAILURE: ONE OR MORE PILLARS ENCOUNTERED ERRORS{RESET}")
        print(f"{RED}{BOLD}======================================================================{RESET}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
