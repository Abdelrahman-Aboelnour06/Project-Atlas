"""
Test Extension Packaging and Security Audit Tool
backend/tests/test_extension_packager.py
"""

import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from tools.package_extension import audit_manifest, audit_script_security, build_package

CLIENT_DIR = Path(__file__).resolve().parent.parent.parent / "client-script"


def test_manifest_v3_validity():
    manifest_path = CLIENT_DIR / "manifest.json"
    data = audit_manifest(manifest_path)
    assert data["manifest_version"] == 3
    assert data["name"]
    assert data["version"]
    assert "service_worker" in data["background"]


def test_script_security_zero_eval():
    findings = audit_script_security(CLIENT_DIR)
    # Ensure zero dangerous eval or API key violations in production scripts
    assert len(findings) == 0, f"Found security issues: {findings}"


def test_build_package_dry_run(tmp_path):
    dist_dir = tmp_path / "dist"
    zip_path = build_package(client_dir=CLIENT_DIR, dist_dir=dist_dir, verify_only=False)
    assert zip_path.exists()
    assert zip_path.suffix == ".zip"

    manifest_file = dist_dir / "release-manifest.json"
    assert manifest_file.exists()
    with open(manifest_file, "r", encoding="utf-8") as f:
        meta = json.load(f)
    assert meta["file_count"] > 10
    assert meta["package_sha256"]
