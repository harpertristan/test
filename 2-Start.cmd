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
if errorlevel 1 (
  echo Зависимости не установлены. Запустите 1-Install.cmd и проверьте ошибку.
  pause
  exit /b 1
)
node scripts\start-desktop.js
if errorlevel 1 pause
popd
