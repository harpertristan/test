@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS 22 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Please update Node.js to version 22 or newer.
  pause
  exit /b 1
)
node scripts\stop-desktop.js
set "PLAY_SCOUT_EXIT=%ERRORLEVEL%"
pause
popd
exit /b %PLAY_SCOUT_EXIT%
