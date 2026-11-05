#!/usr/bin/env bash
# Import a verified local snapshot into an already installed workspace.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo bash.' >&2; exit 1; }
root=/srv/play-scout-workspace
archive=$(realpath "${1:?Укажите путь к assistant-transfer.tar.gz}")
owner=${2:-}
[[ -f $root/installed && -s $root/workspace.env && -d $root/assistant-data ]] || { echo 'Общая панель ещё не установлена.' >&2; exit 1; }
exec 9>"$root/install.lock"
flock -n 9 || { echo 'Уже выполняется обслуживание. Повторите после завершения.' >&2; exit 1; }
chmod 600 "$archive"
backup="$root/backups/import-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$backup"
python3 "$root/assistant/deploy/play-scout/import-migration.py" "$archive" "$backup/incoming"
owner=$(python3 - "$backup/incoming/assistant.sqlite" "$owner" <<'PY'
import sqlite3,sys,re
with sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True) as db:
    if db.execute('pragma integrity_check').fetchone()[0]!='ok': raise SystemExit('Повреждена база в архиве.')
    rows=[r[0] for r in db.execute('select username from users order by id')]
    chosen=sys.argv[2]
    if not chosen and len(rows)==1: chosen=rows[0]
    if chosen not in rows or not re.fullmatch(r'[a-zA-Z0-9_.-]{3,50}',chosen):
        raise SystemExit('Укажите вторым аргументом прежний логин владельца компаний. Исходные данные не изменены.')
    print(chosen)
PY
)
chown -R 1000:1000 "$backup/incoming"
cp "$root/workspace.env" "$backup/workspace.env"
python3 - "$backup/workspace.env" "$backup/incoming.env" "$owner" <<'PY'
import pathlib,sys
lines=pathlib.Path(sys.argv[1]).read_text().splitlines()
lines=[line for line in lines if not line.startswith('WORKSPACE_USER=')]
pathlib.Path(sys.argv[2]).write_text('\n'.join(lines+['WORKSPACE_USER='+sys.argv[3]])+'\n')
PY
args=()
while IFS= read -r file; do args+=(-f "$file"); done < "$root/base-files.list"
d(){ env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
compose(){ d compose --project-name play-scout --env-file /srv/play-scout/deployment.env --env-file "$root/workspace.env" "${args[@]}" -f "$root/compose.yaml" --profile public "$@"; }
compose config --quiet
rollback(){
 local code=${1:-$?}
 trap - ERR INT TERM
 echo 'Импорт не завершён. Возвращаем прежние данные помощника.' >&2
 compose stop registration-assistant || true
 if [[ -d $backup/previous-data ]]; then
  if [[ -d $root/assistant-data ]]; then mv "$root/assistant-data" "$backup/failed-data"; fi
  mv "$backup/previous-data" "$root/assistant-data"
 fi
 cp "$backup/workspace.env" "$root/workspace.env"
 compose up -d --no-build --no-deps --wait registration-assistant || true
 exit "$code"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
# Only the assistant stops; CRM, HTTPS and Ollama continue running.
compose stop registration-assistant
mv "$root/assistant-data" "$backup/previous-data"
mv "$backup/incoming" "$root/assistant-data"
cp "$backup/incoming.env" "$root/workspace.env"
compose up -d --force-recreate --no-build --no-deps --wait registration-assistant
trap - ERR INT TERM
printf 'Готово. Документы, база и сохранённые ключи перенесены.\nПрежние данные сохранены: %s/previous-data\nОткройте /assistant/ и обновите страницу.\n' "$backup"
