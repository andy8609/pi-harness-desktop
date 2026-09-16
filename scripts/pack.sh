#!/usr/bin/env bash
# Pi Desktop - cross-platform packaging (run on the matching OS)
#   ./scripts/pack.sh win     -> Windows: nsis + zip
#   ./scripts/pack.sh mac     -> macOS: dmg + zip (x64 + arm64)
#   ./scripts/pack.sh all     -> both (only works on macOS)
set -euo pipefail
cd "$(dirname "$0")/.."

# 国内网络：使用 npmmirror 镜像（已设置则不覆盖）
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

TARGET="${1:-win}"
case "$TARGET" in
  win) npm run pack:win ;;
  mac) npm run pack:mac ;;
  all) npm run pack:all ;;
  *)   echo "Usage: $0 [win|mac|all]"; exit 1 ;;
esac

echo
echo "[OK] Done. Artifacts are in: $(pwd)/release"
