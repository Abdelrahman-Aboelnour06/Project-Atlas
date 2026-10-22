"""
Project Atlas — Chrome Web Store Packaging & Security Audit Pipeline
tools/package_extension.py

Validates Manifest V3 compliance, audits client scripts for security vulnerabilities
(eval, new Function, hardcoded API keys), verifies asset integrity, and builds a
clean, production-signed zip package for the Chrome Web Store Developer Dashboard.
"""

import os
import re
import sys
import json
import zipfile
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Any

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIR = ROOT_DIR / "client-script"
DIST_DIR = ROOT_DIR / "dist"

# Disallowed dangerous patterns in client-side code
DANGEROUS_PATTERNS = [
    (re.compile(r"\beval\s*\("), "Disallowed dynamic code evaluation: eval()"),
    (re.compile(r"\bnew\s+Function\s*\("), "Disallowed dynamic code evaluation: new Function()"),
    (re.compile(r"gsk_[a-zA-Z0-9]{40,}"), "Detected hardcoded Groq API key in client assets"),
    (re.compile(r"sk-[a-zA-Z0-9]{32,}"), "Detected hardcoded OpenAI API key in client assets"),
]

# Excluded files when creating production zip
EXCLUDE_PATTERNS = [
    r"^test_.*\.js$",
    r"\.DS_Store$",
    r"\.git.*",
    r".*\.map$",
]


class ExtensionAuditError(Exception):
    """Raised when an extension security audit check fails."""
    pass


def compute_file_hash(path: Path) -> str:
    """Computes SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def audit_manifest(manifest_path: Path) -> Dict[str, Any]:
    """Audits manifest.json against Chrome Web Store MV3 requirements."""
    if not manifest_path.exists():
        raise ExtensionAuditError(f"manifest.json not found at {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 1. Manifest version
    mv = data.get("manifest_version")
    if mv != 3:
        raise ExtensionAuditError(f"manifest_version must be 3, found {mv}")

    # 2. Required metadata
    for req_field in ["name", "version", "description", "background"]:
        if req_field not in data:
            raise ExtensionAuditError(f"Missing required manifest field: {req_field}")

    # 3. Background worker
    bg = data.get("background", {})
    if "service_worker" not in bg:
        raise ExtensionAuditError("Manifest V3 requires background.service_worker")

    worker_file = CLIENT_DIR / bg["service_worker"]
    if not worker_file.exists():
        raise ExtensionAuditError(f"Declared service worker does not exist: {worker_file}")

    # 4. Icon assets
    icons = data.get("icons", {})
    for size, rel_path in icons.items():
        icon_file = CLIENT_DIR / rel_path
        if not icon_file.exists():
            raise ExtensionAuditError(f"Declared icon size {size} not found at {icon_file}")

    return data


def audit_script_security(client_dir: Path) -> List[Tuple[str, str, int]]:
    """Scans all JS and HTML files in client_dir for security risks."""
    findings = []

    for file_path in client_dir.rglob("*"):
        if file_path.suffix not in [".js", ".html"]:
            continue
        # Skip unit test scripts from security failure
        if file_path.name.startswith("test_"):
            continue

        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            findings.append((str(file_path), f"Could not read file: {e}", 0))
            continue

        lines = content.splitlines()
        for line_no, line in enumerate(lines, start=1):
            for pattern, reason in DANGEROUS_PATTERNS:
                if pattern.search(line):
                    findings.append((str(file_path.relative_to(client_dir)), reason, line_no))

    return findings


def build_package(client_dir: Path = CLIENT_DIR, dist_dir: Path = DIST_DIR, verify_only: bool = False) -> Path:
    """Audits and packages extension files into production .zip."""
    print(f"[audit] Auditing extension source: {client_dir}")

    # Step 1: Manifest check
    manifest_path = client_dir / "manifest.json"
    manifest = audit_manifest(manifest_path)
    version = manifest.get("version", "1.0.0")
    print(f"  [OK] Manifest V3 validated: {manifest.get('name')} v{version}")

    # Step 2: Code security scan
    security_issues = audit_script_security(client_dir)
    if security_issues:
        for file_rel, issue, line in security_issues:
            print(f"  [X] SECURITY ERROR in {file_rel}:{line} -> {issue}", file=sys.stderr)
        raise ExtensionAuditError(f"Security audit failed with {len(security_issues)} violations.")
    print("  [OK] Security audit passed: zero eval(), new Function(), or leaked API credentials.")

    if verify_only:
        print("[audit] Verification only requested — skipping zip creation.")
        return Path("")

    # Step 3: Create distribution zip
    dist_dir.mkdir(parents=True, exist_ok=True)
    zip_filename = f"atlas-extension-v{version}.zip"
    zip_path = dist_dir / zip_filename

    files_added = []
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(client_dir):
            for file in sorted(files):
                full_path = Path(root) / file
                rel_path = full_path.relative_to(client_dir)
                rel_str = str(rel_path).replace("\\", "/")

                # Check ignore patterns
                should_skip = any(re.match(p, file) for p in EXCLUDE_PATTERNS)
                if should_skip:
                    continue

                zf.write(full_path, arcname=rel_str)
                files_added.append({
                    "path": rel_str,
                    "bytes": full_path.stat().st_size,
                    "sha256": compute_file_hash(full_path),
                })

    # Step 4: Write release manifest
    manifest_record = {
        "extension_name": manifest.get("name"),
        "version": version,
        "package_filename": zip_filename,
        "package_sha256": compute_file_hash(zip_path),
        "package_size_bytes": zip_path.stat().st_size,
        "file_count": len(files_added),
        "files": files_added,
    }

    release_meta_path = dist_dir / "release-manifest.json"
    with open(release_meta_path, "w", encoding="utf-8") as f:
        json.dump(manifest_record, f, indent=2)

    print(f"[package] Built package: {zip_path} ({len(files_added)} files, {zip_path.stat().st_size} bytes)")
    print(f"[package] SHA-256: {manifest_record['package_sha256']}")
    print(f"[package] Release metadata written: {release_meta_path}")

    return zip_path


if __name__ == "__main__":
    verify = "--verify-only" in sys.argv
    try:
        build_package(verify_only=verify)
    except Exception as exc:
        print(f"[error] Packaging failed: {exc}", file=sys.stderr)
        sys.exit(1)
