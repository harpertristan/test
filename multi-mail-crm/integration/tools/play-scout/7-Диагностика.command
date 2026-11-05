#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/doctor.js
if command -v ollama >/dev/null 2>&1; then
  ollama --version
  ollama list
  ollama ps
fi
read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
