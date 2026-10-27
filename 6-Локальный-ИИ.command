#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v ollama >/dev/null 2>&1; then
  echo 'Установите и откройте Ollama, затем запустите этот файл снова.'
  open 'https://ollama.com/download/mac'
else
  echo 'Скачиваем небольшую qwen2.5:3b для экономного отбора на Mac.'
  ollama pull qwen2.5:3b
  echo 'В CRM выберите Ollama → qwen2.5:3b → Экономный режим и сохраните.'
  ollama list
fi
read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
