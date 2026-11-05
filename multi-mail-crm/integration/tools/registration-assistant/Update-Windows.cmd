@echo off
setlocal
cd /d "%~dp0"
node "%~dp0scripts\update.mjs" --target "%~dp0." --start
set "UPDATE_RESULT=%ERRORLEVEL%"
pause
exit /b %UPDATE_RESULT%
