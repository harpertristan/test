#!/bin/bash
# macOS Bash 3.2 compatible. Download outside the existing working folder.
main() {
  set -e
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin:$PATH"
  PLAY_SCOUT_TARGET="${1:-$PWD}"
  if [ "$#" -gt 0 ]; then shift; fi
  PLAY_SCOUT_START=""
  PLAY_SCOUT_SOURCE=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --start) PLAY_SCOUT_START=--start; shift ;;
      --source) PLAY_SCOUT_SOURCE="$2"; shift 2 ;;
      *) printf 'Неизвестный параметр: %s\n' "$1" >&2; return 1 ;;
    esac
  done
  if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    printf 'Установите Node.js LTS 22 или новее: https://nodejs.org/\n' >&2
    return 1
  fi
  PLAY_SCOUT_TARGET=$(cd -- "$PLAY_SCOUT_TARGET" && pwd -P)
  node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[1]));if(p.name!=="play-finance-finder")throw Error("Выбрана не папка Play Scout")' "$PLAY_SCOUT_TARGET/package.json"
  PLAY_SCOUT_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/play-scout-update.XXXXXX")
  trap 'rm -rf -- "$PLAY_SCOUT_TEMP"' EXIT
  if [ -z "$PLAY_SCOUT_SOURCE" ]; then
    printf 'Скачиваем обновление с GitHub…\n'
    curl --fail --location --retry 2 --connect-timeout 15 --max-time 120 'https://codeload.github.com/harpertristan/test/zip/refs/heads/main' -o "$PLAY_SCOUT_TEMP/release.zip"
    mkdir "$PLAY_SCOUT_TEMP/release"
    if command -v ditto >/dev/null 2>&1; then
      ditto -x -k "$PLAY_SCOUT_TEMP/release.zip" "$PLAY_SCOUT_TEMP/release"
    else
      unzip -q "$PLAY_SCOUT_TEMP/release.zip" -d "$PLAY_SCOUT_TEMP/release"
    fi
    for PLAY_SCOUT_FOLDER in "$PLAY_SCOUT_TEMP/release/"*; do
      if [ -f "$PLAY_SCOUT_FOLDER/package.json" ]; then PLAY_SCOUT_SOURCE="$PLAY_SCOUT_FOLDER"; fi
    done
  fi
  if [ ! -f "$PLAY_SCOUT_SOURCE/scripts/update-in-place.js" ]; then
    printf 'В архиве нет модуля обновления. Рабочая папка не изменена.\n' >&2
    return 1
  fi
  PLAY_SCOUT_SOURCE=$(cd -- "$PLAY_SCOUT_SOURCE" && pwd -P)
  printf 'Архив распакован. Проверяем папку и устанавливаем обновление…\n'
  if [ -n "$PLAY_SCOUT_START" ]; then
    node "$PLAY_SCOUT_SOURCE/scripts/update-in-place.js" "$PLAY_SCOUT_SOURCE" "$PLAY_SCOUT_TARGET" --start
  else
    node "$PLAY_SCOUT_SOURCE/scripts/update-in-place.js" "$PLAY_SCOUT_SOURCE" "$PLAY_SCOUT_TARGET"
  fi
}
main "$@"; exit $?
