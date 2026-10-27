@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
node scripts\stop-desktop.js
pause
popd
