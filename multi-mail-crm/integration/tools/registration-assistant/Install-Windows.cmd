@echo off
setlocal
cd /d "%~dp0"
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
call npm ci --ignore-scripts
if errorlevel 1 (
  echo Installation failed. Check Internet access and try again.
  pause
  exit /b 1
)
echo Create a user only on first installation.
node --disable-warning=ExperimentalWarning scripts/create-user.js
if errorlevel 1 (
  pause
  exit /b 1
)
echo Ready. Run Start-Windows.cmd
pause
