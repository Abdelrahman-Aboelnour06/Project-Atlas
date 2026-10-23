#!/usr/bin/env python3
"""
ci/verify_all_tests_run.py — CI Gatekeeper Self-Check Verification Script

Architectural Verification Gate for Project Atlas:
1. Programmatically discovers 100% of test files across backend/tests, client-script, demo-site, and ci/e2e.
2. Executes or verifies execution of all discovered test files.
3. Enforces that ZERO test files are skipped or omitted.
4. Enforces Quality Floor:
   - Backend tests >= 782
   - JavaScript tests >= 814
5. Fails with non-zero exit code if any test file is missing, any test fails, or quality floor is breached.
"""

import sys
import os
import re
import json
import subprocess
import argparse
from pathlib import Path
from typing import Dict, List, Set, Tuple

# Quality Floors (Milestone 4 Elevated Floors)
BACKEND_TEST_FLOOR = 782
JS_TEST_FLOOR = 814

# Authoritative Deterministic CI E2E Suites
CI_E2E_SUITES = {
    "harness.js",
    "ui_sidebar_behavior.js",
    "a11y_axe.js",
    "run_multi_tab_suite.js",
    "test_portal_fixtures_e2e.js",
    "test_latent_reveal_e2e.js",
}


def find_repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        if (parent / ".git").exists() or (parent / "backend" / "app").exists():
            return parent
    return Path.cwd()


def discover_all_test_files(repo_root: Path) -> Dict[str, List[Path]]:
    """Programmatically discover all test files across the repository."""
    backend_dir = repo_root / "backend" / "tests"
    client_dir = repo_root / "client-script"
    demo_dir = repo_root / "demo-site"
    e2e_dir = repo_root / "ci" / "e2e"

    discovered = {
        "backend": [],
        "client_script": [],
        "demo_site": [],
        "e2e": [],
    }

    # 1. Backend tests
    if backend_dir.exists():
        for p in backend_dir.rglob("test_*.py"):
            rel_str = str(p.relative_to(repo_root))
            if "venv" not in rel_str and "__pycache__" not in rel_str and ".pytest_cache" not in rel_str:
                discovered["backend"].append(p)
        for p in backend_dir.rglob("*_test.py"):
            rel_str = str(p.relative_to(repo_root))
            if "venv" not in rel_str and "__pycache__" not in rel_str and ".pytest_cache" not in rel_str:
                if p not in discovered["backend"]:
                    discovered["backend"].append(p)

    # 2. Client-script tests
    if client_dir.exists():
        for p in client_dir.glob("test_*.js"):
            discovered["client_script"].append(p)

    # 3. Demo-site tests
    if demo_dir.exists():
        for p in demo_dir.glob("test_*.js"):
            discovered["demo_site"].append(p)

    # 4. E2E tests (Authoritative CI Test Suites)
    if e2e_dir.exists():
        for p in e2e_dir.glob("*.js"):
            if p.name in CI_E2E_SUITES:
                discovered["e2e"].append(p)

    # Sort deterministically
    for k in discovered:
        discovered[k].sort()

    return discovered


def get_python_executable(repo_root: Path) -> str:
    """Find appropriate Python executable with pytest."""
    candidates = [
        repo_root / "backend" / "venv_linux" / "bin" / "python",
        repo_root / "backend" / "venv" / "bin" / "python",
        repo_root / "backend" / "venv" / "Scripts" / "python.exe",
        Path(sys.executable),
    ]
    for c in candidates:
        if c.exists() and os.access(c, os.X_OK):
            try:
                res = subprocess.run([str(c), "-m", "pytest", "--version"], capture_output=True, timeout=5)
                if res.returncode == 0:
                    return str(c)
            except Exception:
                continue
    return sys.executable


def parse_js_test_output(output: str) -> Tuple[int, int]:
    """Parse passed and failed counts from standard JS test outputs."""
    passed = 0
    failed = 0
    matches = re.findall(r'(\d+)\s+passed,\s+(\d+)\s+failed', output, re.IGNORECASE)
    if matches:
        last_match = matches[-1]
        passed = int(last_match[0])
        failed = int(last_match[1])
    else:
        passed_ticks = len(re.findall(r'✓|PASS', output))
        failed_ticks = len(re.findall(r'✗|FAIL', output))
        if passed_ticks > 0 or failed_ticks > 0:
            passed = passed_ticks
            failed = failed_ticks
    return passed, failed


def run_self_check(repo_root: Path, run_tests: bool = True) -> int:
    """Execute full CI Gatekeeper self-check."""
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    print("=" * 70)
    print("  ATLAS CI GATEKEEPER SELF-CHECK VERIFICATION")
    print("=" * 70)
    print(f"Repository Root: {repo_root}")

    discovered = discover_all_test_files(repo_root)

    total_discovered_backend = len(discovered["backend"])
    total_discovered_client = len(discovered["client_script"])
    total_discovered_demo = len(discovered["demo_site"])
    total_discovered_e2e = len(discovered["e2e"])
    total_discovered_files = (
        total_discovered_backend +
        total_discovered_client +
        total_discovered_demo +
        total_discovered_e2e
    )

    print(f"\n[DISCOVERY] Discovered {total_discovered_files} total test files:")
    print(f"  - Backend ({total_discovered_backend} files in backend/tests/)")
    print(f"  - Client Script ({total_discovered_client} files in client-script/)")
    print(f"  - Demo Site ({total_discovered_demo} files in demo-site/)")
    print(f"  - E2E Harness ({total_discovered_e2e} files in ci/e2e/)")

    if not run_tests:
        print("\n[INFO] Discovery completed (--dry-run).")
        return 0

    py_exe = get_python_executable(repo_root)
    print(f"\n[EXECUTION] Using Python executable: {py_exe}")

    executed_backend_files = set()
    backend_passed_count = 0
    backend_failed_count = 0

    # 1. Run Backend Pytest Suite
    print("\n>>> Running Backend Pytest Suite (All Modules)...")
    junit_xml = repo_root / "test_results_backend.xml"
    pytest_cmd = [
        py_exe, "-m", "pytest", "backend/tests",
        "-v", "--tb=short",
        f"--junitxml={junit_xml}"
    ]
    env = os.environ.copy()
    env["LLM_PROVIDER"] = "mock"

    res = subprocess.run(pytest_cmd, cwd=str(repo_root), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    pytest_output = res.stdout + res.stderr

    # Parse JUnit XML or output to record executed files and counts
    if junit_xml.exists():
        import xml.etree.ElementTree as ET
        try:
            tree = ET.parse(junit_xml)
            root = tree.getroot()
            for tc in root.iter("testcase"):
                file_attr = tc.attrib.get("file")
                if file_attr:
                    full_p = (repo_root / file_attr).resolve()
                    executed_backend_files.add(full_p)
            for ts in root.iter("testsuite"):
                tests = int(ts.attrib.get("tests", 0))
                failures = int(ts.attrib.get("failures", 0))
                errors = int(ts.attrib.get("errors", 0))
                backend_passed_count += (tests - failures - errors)
                backend_failed_count += (failures + errors)
        except Exception as e:
            print(f"  [WARN] Failed to parse JUnit XML: {e}")
        finally:
            try:
                junit_xml.unlink()
            except Exception:
                pass

    if not executed_backend_files:
        for line in pytest_output.splitlines():
            for p in discovered["backend"]:
                rel = p.relative_to(repo_root)
                if str(rel) in line:
                    executed_backend_files.add(p.resolve())
        m = re.search(r'(\d+)\s+passed', pytest_output)
        if m:
            backend_passed_count = int(m.group(1))
        m_fail = re.search(r'(\d+)\s+failed', pytest_output)
        if m_fail:
            backend_failed_count = int(m_fail.group(1))

    print(f"  Backend Execution: {len(executed_backend_files)}/{total_discovered_backend} files executed")
    print(f"  Backend Passed Tests: {backend_passed_count} (Floor: {BACKEND_TEST_FLOOR})")
    print(f"  Backend Failed Tests: {backend_failed_count}")

    # 2. Run JavaScript Core Suites (client-script and demo-site)
    js_passed_total = 0
    js_failed_total = 0
    executed_js_files = set()

    print("\n>>> Running JavaScript Core Suites...")
    js_suites = discovered["client_script"] + discovered["demo_site"]

    for js_file in js_suites:
        rel = js_file.relative_to(repo_root)
        print(f"  -> Running node {rel}...")
        sub_res = subprocess.run(["node", str(js_file)], cwd=str(repo_root), capture_output=True, text=True, encoding="utf-8", errors="replace")
        out = sub_res.stdout + sub_res.stderr
        passed, failed = parse_js_test_output(out)
        if sub_res.returncode != 0 and failed == 0:
            failed = 1
        executed_js_files.add(js_file.resolve())
        js_passed_total += passed
        js_failed_total += failed
        print(f"     Result: {passed} passed, {failed} failed (exit code {sub_res.returncode})")

    print(f"  Core JS Passed Tests: {js_passed_total} (Floor: {JS_TEST_FLOOR})")
    print(f"  Core JS Failed Tests: {js_failed_total}")

    # 3. Run Playwright E2E Harnesses
    print("\n>>> Running Playwright E2E Harnesses...")
    executed_e2e_files = set()
    e2e_failed = 0
    for e2e_harness in discovered["e2e"]:
        rel = e2e_harness.relative_to(repo_root)
        if e2e_harness.exists():
            print(f"  -> Running node {rel}...")
            sub_res = subprocess.run(["node", str(e2e_harness)], cwd=str(repo_root), capture_output=True, text=True, encoding="utf-8", errors="replace")
            if sub_res.returncode == 0:
                print(f"     ✓ {rel} passed cleanly")
                executed_e2e_files.add(e2e_harness.resolve())
            else:
                print(f"     ✗ {rel} failed (exit code {sub_res.returncode})")
                print(sub_res.stdout[-300:] if sub_res.stdout else "")
                print(sub_res.stderr[-300:] if sub_res.stderr else "")
                e2e_failed += 1
        else:
            print(f"  -> [MISSING] Required E2E harness file not found: {rel}")
            e2e_failed += 1

    # 4. Gatekeeper Assertions & Verifications
    print("\n" + "=" * 70)
    print("  GATEKEEPER VERIFICATION RESULTS")
    print("=" * 70)

    gate_failed = False

    # Check 1: 100% Backend test files executed
    missing_backend = [p for p in discovered["backend"] if p.resolve() not in executed_backend_files]
    if missing_backend:
        print(f"\n[FAIL] OMITTED BACKEND TEST FILES ({len(missing_backend)} skipped):")
        for p in missing_backend:
            print(f"  - {p.relative_to(repo_root)}")
        gate_failed = True
    else:
        print(f"\n[PASS] 100% Backend test files executed ({total_discovered_backend}/{total_discovered_backend})")

    # Check 2: 100% Core JS test files executed
    missing_js = [p for p in js_suites if p.resolve() not in executed_js_files]
    if missing_js:
        print(f"\n[FAIL] OMITTED JAVASCRIPT TEST FILES ({len(missing_js)} skipped):")
        for p in missing_js:
            print(f"  - {p.relative_to(repo_root)}")
        gate_failed = True
    else:
        print(f"\n[PASS] 100% JavaScript test files executed ({len(js_suites)}/{len(js_suites)})")

    # Check 2b: 100% Playwright E2E Harnesses executed
    missing_e2e = [p for p in discovered["e2e"] if p.resolve() not in executed_e2e_files]
    if missing_e2e:
        print(f"\n[FAIL] OMITTED E2E HARNESSES ({len(missing_e2e)} skipped/missing):")
        for p in missing_e2e:
            print(f"  - {p.relative_to(repo_root)}")
        gate_failed = True
    else:
        print(f"\n[PASS] 100% Playwright E2E Harnesses executed ({len(discovered['e2e'])}/{len(discovered['e2e'])})")

    # Check 3: Quality Floor — Backend
    if backend_passed_count < BACKEND_TEST_FLOOR:
        print(f"\n[FAIL] Backend quality floor breach: {backend_passed_count} passed < {BACKEND_TEST_FLOOR} required")
        gate_failed = True
    else:
        print(f"[PASS] Backend quality floor met: {backend_passed_count} passed >= {BACKEND_TEST_FLOOR} floor")

    # Check 4: Quality Floor — JS
    if js_passed_total < JS_TEST_FLOOR:
        print(f"\n[FAIL] JavaScript quality floor breach: {js_passed_total} passed < {JS_TEST_FLOOR} required")
        gate_failed = True
    else:
        print(f"[PASS] JavaScript quality floor met: {js_passed_total} passed >= {JS_TEST_FLOOR} floor")

    # Check 5: Zero Failures
    total_failures = backend_failed_count + js_failed_total + e2e_failed
    if total_failures > 0:
        print(f"\n[FAIL] Non-zero test failures detected: {total_failures} failures across suites")
        gate_failed = True
    else:
        print(f"[PASS] Zero test failures across all executed test suites (0 failures)")

    # Check 6: Obsolete random.txt check
    random_txt = repo_root / "random.txt"
    if random_txt.exists():
        print(f"[FAIL] Obsolete random.txt is still present at {random_txt.relative_to(repo_root)}")
        gate_failed = True
    else:
        print("[PASS] Obsolete random.txt verified absent from repository")

    print("\n" + "=" * 70)
    if gate_failed:
        print("  CI GATEKEEPER STATUS: FAILED ❌")
        print("=" * 70)
        return 1
    else:
        print("  CI GATEKEEPER STATUS: ALL CHECKS PASSED ✅")
        print("=" * 70)
        return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atlas CI Gatekeeper Self-Check Verification")
    parser.add_argument("--dry-run", action="store_true", help="Only discover test files without running")
    args = parser.parse_args()

    root = find_repo_root()
    code = run_self_check(root, run_tests=not args.dry_run)
    sys.exit(code)
