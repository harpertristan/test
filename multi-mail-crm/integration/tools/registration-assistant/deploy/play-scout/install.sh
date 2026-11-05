#!/usr/bin/env bash
# Install a shared assistant alongside the existing /srv/play-scout deployment.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo bash.' >&2; exit 1; }
scout_root=/srv/play-scout
suite=/srv/play-scout-workspace
archive=''
owner=''
while (($#)); do case "$1" in --archive) archive=$(realpath "$2"); shift 2;; --user) owner=$2; shift 2;; *) echo "Неизвестный аргумент: $1" >&2; exit 1;; esac; done
for tool in docker git python3 tar curl openssl flock; do command -v "$tool" >/dev/null || { echo "Не найдена команда $tool" >&2; exit 1; }; done
d(){ env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
d info >/dev/null
[[ -f $scout_root/code/deploy/google-cloud/compose.yaml && -f $scout_root/deployment.env && -f $scout_root/app.env && -s $scout_root/data/state.json ]] || { echo 'Ожидается действующий Play Scout в /srv/play-scout. Установка не изменена.' >&2; exit 1; }
if [[ -f $suite/installed ]]; then echo 'Рабочее пространство уже установлено. Используйте /srv/play-scout-workspace/workspace.sh status'; exit 0; fi
mkdir -p "$suite" "$suite/backups"
chmod 700 "$suite" "$suite/backups"
exec 9>"$suite/install.lock"
flock -n 9 || { echo 'Другой перенос уже выполняется. Дождитесь его завершения.' >&2; exit 1; }
# Inspect running Compose labels rather than guessing whether GPU mode is enabled.
app_id=$(d ps -q --filter label=com.docker.compose.project=play-scout --filter label=com.docker.compose.service=app)
[[ -n $app_id && $app_id != *$'\n'* ]] || { echo 'Не найден единственный работающий контейнер Play Scout.' >&2; exit 1; }
config_files=$(d inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$app_id")
[[ -n $config_files ]] || { echo 'Не найдены исходные Compose-файлы.' >&2; exit 1; }
IFS=',' read -r -a original_files <<< "$config_files"
original_args=()
: > "$suite/base-files.list"
for file in "${original_files[@]}"; do [[ -f $file && $file == "$scout_root/"* ]] || { echo 'Неожиданный путь Compose. Требуется проверка установки.' >&2; exit 1; }; original_args+=(-f "$file"); printf '%s\n' "$file" >> "$suite/base-files.list"; done
old(){ d compose --project-name play-scout --env-file "$scout_root/deployment.env" "${original_args[@]}" --profile public "$@"; }
# Preserve the old immutable image and Caddy configuration before downloading code.
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
backup="$suite/backups/$stamp"
mkdir "$backup"
old config > "$backup/compose.yaml"
d inspect --format '{{.Image}}' "$app_id" > "$backup/app-image"
caddy_id=$(d ps -q --filter label=com.docker.compose.project=play-scout --filter label=com.docker.compose.service=caddy)
[[ -n $caddy_id ]] || { echo 'Caddy не запущен. Сначала восстановите текущий HTTPS.' >&2; exit 1; }
caddy_file=$(d inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$caddy_id")
[[ -f $caddy_file ]] || { echo 'Файл Caddy не найден.' >&2; exit 1; }
cp "$caddy_file" "$backup/Caddyfile"
cp "$scout_root/deployment.env" "$backup/deployment.env"
d inspect --format '{{.Image}}' "$caddy_id" > "$backup/caddy-image"
python3 - "$backup" <<'PYBACKUP'
import json,pathlib,sys
folder=pathlib.Path(sys.argv[1])
images={'services':{'app':{'image':(folder/'app-image').read_text().strip()},'caddy':{'image':(folder/'caddy-image').read_text().strip(),'volumes':[str(folder/'Caddyfile')+':/etc/caddy/Caddyfile:ro']}}}
(folder/'rollback.json').write_text(json.dumps(images))
PYBACKUP
checkout(){
 local directory=$1 branch=$2
 if [[ -d $directory/.git ]]; then
  [[ -z $(git -C "$directory" status --porcelain) ]] || { echo "Локальные изменения в $directory. Они не будут перезаписаны." >&2; exit 1; }
  git -C "$directory" fetch --depth 1 origin "$branch"
  git -C "$directory" checkout --detach FETCH_HEAD
 else
  git clone --depth 1 --branch "$branch" https://github.com/harpertristan/test.git "$directory"
 fi
}
checkout "$suite/scout" play-scout-workspace
checkout "$suite/assistant" registration-assistant
if [[ -n $archive ]]; then python3 "$suite/assistant/deploy/play-scout/import-migration.py" "$archive" "$suite/assistant-data"; fi
mkdir -p "$suite/assistant-data"
# Select an existing data owner without another login form.
if [[ -f $suite/assistant-data/assistant.sqlite ]]; then
 owner=$(python3 - "$suite/assistant-data/assistant.sqlite" "$owner" <<'PY'
import sqlite3,sys
rows=[r[0] for r in sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True).execute('select username from users order by id')]
chosen=sys.argv[2]
if chosen and chosen not in rows: raise SystemExit('Указанный пользователь не найден в перенесённой базе.')
if not chosen and len(rows)>1: raise SystemExit('В базе несколько пользователей. Повторите без --archive, указав --user ИМЯ существующего владельца компаний.')
print(chosen or (rows[0] if rows else 'workspace'))
PY
 )
fi
[[ -z $owner || $owner =~ ^[a-zA-Z0-9_.-]{3,50}$ ]] || { echo 'Неверное имя владельца данных.' >&2; exit 1; }
chown -R 1000:1000 "$suite/assistant-data"
find "$suite/assistant-data" -type d -exec chmod 700 {} +
find "$suite/assistant-data" -type f -exec chmod 600 {} +
if [[ ! -f $suite/workspace.env ]]; then
 printf 'WORKSPACE_SHARED_SECRET=%s\nWORKSPACE_USER=%s\n' "$(openssl rand -hex 32)" "$owner" > "$suite/workspace.env"
fi
cp "$suite/assistant/deploy/play-scout/compose.example.yaml" "$suite/compose.yaml"
new(){ d compose --project-name play-scout --env-file "$scout_root/deployment.env" --env-file "$suite/workspace.env" "${original_args[@]}" -f "$suite/compose.yaml" --profile public "$@"; }
new config --quiet
printf 'Собираем два приложения. База CRM и Ollama пока работают.\n'
if ! new build app registration-assistant > "$suite/build.log" 2>&1; then tail -n 30 "$suite/build.log"; exit 1; fi
new run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > "$suite/caddy-validation.log" 2>&1
stopped=false
backup_override=false
backup_timer_active=false
rollback(){
 local code=$?
 if $backup_override; then
  if [[ -f $backup/backup-unit.original ]]; then cp "$backup/backup-unit.original" /etc/systemd/system/play-scout-backup.service.d/workspace.conf; else rm -f /etc/systemd/system/play-scout-backup.service.d/workspace.conf; fi
  systemctl daemon-reload || true
 fi
 if $stopped; then
  echo 'Установка не завершена. Возвращаем прежний Play Scout.' >&2
  new stop registration-assistant >/dev/null 2>&1 || true
  d compose --project-name play-scout --env-file "$backup/deployment.env" -f "$backup/compose.yaml" -f "$backup/rollback.json" --profile public up -d --no-build --no-deps app caddy > "$suite/rollback.log" 2>&1 || true
 fi
 if $backup_timer_active; then systemctl start play-scout-backup.timer || true; fi
 exit "$code"
}
trap rollback ERR
if command -v systemctl >/dev/null && systemctl cat play-scout-backup.service >/dev/null 2>&1; then
 if systemctl is-active --quiet play-scout-backup.service; then echo 'Сейчас идёт резервное копирование. Дождитесь его завершения и повторите установку без --archive.' >&2; exit 1; fi
 if systemctl is-active --quiet play-scout-backup.timer; then systemctl stop play-scout-backup.timer; backup_timer_active=true; fi
 touch "$backup/backup-service-present"
 if [[ -f /etc/systemd/system/play-scout-backup.service.d/workspace.conf ]]; then cp /etc/systemd/system/play-scout-backup.service.d/workspace.conf "$backup/backup-unit.original"; fi
fi
old stop app
stopped=true
# The data and journal are archived together while the app is stopped.
tar -C "$scout_root" -czf "$backup/play-scout-data.tar.gz" data app.env
tar -tzf "$backup/play-scout-data.tar.gz" >/dev/null
new up -d --no-deps --wait --wait-timeout 180 app registration-assistant
new up -d --no-deps --wait --wait-timeout 120 caddy
# The cloud app reads its own configured password only for this local self-test.
# Neither password nor workspace key is printed or sent to a third party.
new exec -T app node --input-type=module - <<'JS'
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
const target=process.env.ASSISTANT_PUBLIC_ORIGIN;
if(!target)throw Error('Не настроен публичный адрес общего пространства.');
const headers=process.env.APP_PASSWORD?{Authorization:'Basic '+Buffer.from('admin:'+process.env.APP_PASSWORD).toString('base64')}:{};
const response=await fetch(target+'/assistant/api/me',{headers,signal:AbortSignal.timeout(30000)});
if(!response.ok||(await response.json()).sharedWorkspace!==true)throw Error('Общий доступ не прошёл проверку HTTPS.');
console.log('Общий доступ Play Scout → помощник проверен.');
JS
cp "$suite/assistant/deploy/play-scout/workspace.sh" "$suite/workspace.sh"
chmod 700 "$suite/workspace.sh"
if [[ -f $backup/backup-service-present ]]; then
 mkdir -p /etc/systemd/system/play-scout-backup.service.d
 printf '[Service]\nExecStart=\nExecStart=/bin/bash /srv/play-scout-workspace/workspace.sh backup-and-start\n' > /etc/systemd/system/play-scout-backup.service.d/workspace.conf
 backup_override=true
 systemctl daemon-reload
fi
if $backup_timer_active; then systemctl start play-scout-backup.timer; fi
printf '%s\n' "$backup" > "$suite/last-backup"
touch "$suite/installed"
trap - ERR
printf '\nГотово. В Play Scout появилась вкладка помощника.\nРезервная копия: %s\nПроверка: sudo /srv/play-scout-workspace/workspace.sh status\n' "$backup"
