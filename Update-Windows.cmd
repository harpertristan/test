@echo off
setlocal
cd /d "%~dp0"
echo Stop the application window with Ctrl+C before updating.
echo Keep the data folder and .env file from your existing installation.
pause
call npm ci --ignore-scripts
if errorlevel 1 (
  echo Update failed. Read the error above.
  pause
  exit /b 1
)
echo Dependencies updated. Run Start-Windows.cmd
pause
