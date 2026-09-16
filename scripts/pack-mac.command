#!/usr/bin/env bash
# Pi Desktop - macOS one-click packaging
# Double-click this file in Finder, or run: ./scripts/pack-mac.command
set -euo pipefail
cd "$(dirname "$0")/.."

# 国内网络：使用 npmmirror 镜像（已设置则不覆盖）
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

echo "============================================"
echo "  Pi Desktop - macOS one-click packaging"
echo "============================================"
echo

npm run pack:mac

echo
echo "[OK] Done. Artifacts are in: $(pwd)/release"
echo "     - Pi Desktop-*-mac-x64.dmg / -arm64.dmg"
echo "     - Pi Desktop-*-mac-x64.zip / -arm64.zip"
