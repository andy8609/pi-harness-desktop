@echo off
setlocal enableextensions
cd /d "%~dp0\.."

rem ---- 国内网络：使用 npmmirror 镜像（已设置则不覆盖）----
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo ============================================
echo   Pi Desktop - Windows one-click packaging
echo ============================================
echo.

call npm run pack:win
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. See output above.
  pause
  exit /b 1
)

echo.
echo [OK] Done. Artifacts are in: %CD%\release
echo      - Pi Desktop-*-win-x64.exe   (installer)
echo      - Pi Desktop-*-win-x64.zip   (portable)
pause
