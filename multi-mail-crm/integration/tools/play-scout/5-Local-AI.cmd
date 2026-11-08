@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
where ollama >nul 2>nul
if errorlevel 1 (
  echo Install and open Ollama for Windows, then run this file again.
  start "" "https://ollama.com/download/windows"
  pause
  exit /b 1
)
echo Downloading qwen3.5:4b for an NVIDIA GPU with at least 8 GB VRAM.
ollama pull qwen3.5:4b
if errorlevel 1 (
  echo Check that Ollama is running and the internet connection is available.
  pause
  exit /b 1
)
echo In CRM select Ollama, qwen3.5:4b and Economy mode.
ollama list
set "PLAY_SCOUT_EXIT=%ERRORLEVEL%"
pause
popd
exit /b %PLAY_SCOUT_EXIT%
