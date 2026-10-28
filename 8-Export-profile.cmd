@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
node scripts\transfer-profile.js export
pause
popd
