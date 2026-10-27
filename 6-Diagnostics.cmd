@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
node --version
call npm.cmd run doctor
ollama --version
ollama list
ollama ps
nvidia-smi
pause
popd
