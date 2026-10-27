@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
:menu
echo.
echo 1 - Brave: поиск сайтов и публикаций
echo 2 - OpenAI API
echo 3 - Gemini API
echo 4 - Пароли владельца и просмотра
echo 0 - Выход
choice /C 12340 /N /M "Выберите номер: "
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
