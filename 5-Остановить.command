#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/stop-desktop.js
read -r -p 'Нажмите Enter, чтобы закрыть окно. ' PLAY_SCOUT_REPLY
