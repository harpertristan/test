@echo off
setlocal
cd /d "%~dp0"
echo Open http://127.0.0.1:3100 in your browser after startup.
echo Keep this window open. Press Ctrl+C to stop.
call npm start
pause
