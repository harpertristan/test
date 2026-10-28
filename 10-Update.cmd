@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\update-windows.ps1" -Target "%CD%" -Start
set "PLAY_SCOUT_EXIT=%ERRORLEVEL%"
pause
popd
exit /b %PLAY_SCOUT_EXIT%
