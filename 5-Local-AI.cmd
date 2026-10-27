@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where ollama >nul 2>nul
if errorlevel 1 (
  echo Установите Ollama для Windows, откройте приложение и запустите этот файл снова.
  start "" "https://ollama.com/download/windows"
  pause
  exit /b 1
)
echo Загружаем qwen3.5:4b для NVIDIA с видеопамятью 8 ГБ или больше.
ollama pull qwen3.5:4b
if errorlevel 1 (
  echo Проверьте, что приложение Ollama запущено и есть интернет.
) else (
  echo В CRM выберите Ollama, модель qwen3.5:4b и Экономный режим.
  ollama list
)
pause
popd
