@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Сначала установите Node.js и выполните 1-Install.cmd.
  pause
  exit /b 1
)
if not exist node_modules call npm.cmd ci
node scripts\start-desktop.js
if errorlevel 1 pause
popd
