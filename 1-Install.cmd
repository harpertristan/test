@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js LTS версии 22 или новее с https://nodejs.org/
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Обновите Node.js до версии 22 или новее.
  pause
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 (
  echo Установка не завершена. Сохраните текст ошибки выше.
  pause
  exit /b 1
)
call npm.cmd run doctor
echo Готово. Настройте ключи через 4-Keys.cmd и запускайте 2-Start.cmd.
pause
popd
