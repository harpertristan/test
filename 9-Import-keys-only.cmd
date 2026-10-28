@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js LTS 22 или новее: https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Обновите Node.js до версии 22 или новее.
  pause
  exit /b 1
)
node scripts\import-keys.js
pause
popd
