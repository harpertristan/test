#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run configure:ai
read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_AI_REPLY
