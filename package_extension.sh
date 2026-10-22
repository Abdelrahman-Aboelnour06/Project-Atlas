#!/bin/bash
# package_extension.sh — Project Atlas MV3 Extension Packaging Wrapper (Linux/macOS)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is required but was not found in PATH." >&2
    exit 1
fi

node "$SCRIPT_DIR/client-script/package_extension.js" "$@"
