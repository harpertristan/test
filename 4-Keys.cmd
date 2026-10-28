@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS 22 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Please update Node.js to version 22 or newer.
  pause
  exit /b 1
)
:menu
echo.
echo 1 - Brave search API key
echo 2 - OpenAI API key
echo 3 - Gemini API key
echo 4 - Owner and viewer passwords
echo 0 - Exit
choice /C 12340 /N /M "Select a number: "
if errorlevel 5 goto done
if errorlevel 4 (
  call npm.cmd run stop
  if errorlevel 1 goto menu
  call npm.cmd run configure:access
  goto menu
)
if errorlevel 3 (
  call npm.cmd run configure:gemini
  goto menu
)
if errorlevel 2 (
  call npm.cmd run configure:ai
  goto menu
)
call npm.cmd run configure
goto menu
:done
popd
exit /b 0
