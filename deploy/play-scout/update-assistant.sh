#!/usr/bin/env bash
# Update ONLY registration-assistant, preserving the current combined deployment.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo bash.' >&2; exit 1; }
root=/srv/play-scout-workspace
[[ -d $root/assistant/.git && -f $root/workspace.env ]] || { echo 'Не найдена установка помощника.' >&2; exit 1; }
exec 9>"$root/install.lock"
flock -n 9 || { echo 'Идёт обслуживание. Повторите позже.' >&2; exit 1; }
[[ -z $(git -C "$root/assistant" status --porcelain) ]] || { echo 'Есть локальные изменения помощника. Они не будут перезаписаны.' >&2; exit 1; }
d(){ env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
id=$(d ps -q --filter label=com.docker.compose.service=registration-assistant)
[[ -n $id && $id != *$'\n'* ]] || { echo 'Не найден единственный работающий помощник.' >&2; exit 1; }
project=$(d inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$id")
files=$(d inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$id")
[[ -n $project && -n $files && $files != '<no value>' ]] || { echo 'Не найдена текущая конфигурация Compose.' >&2; exit 1; }
args=(); IFS=',' read -r -a paths <<< "$files"
for file in "${paths[@]}"; do [[ -f $file ]] || { echo 'Один из текущих Compose-файлов недоступен.' >&2; exit 1; };args+=(-f "$file");done
# Use the current files (including a possible mail-tool overlay), never the old installer template.
envs=(); env_files=$(d inspect --format '{{index .Config.Labels "com.docker.compose.project.environment_file"}}' "$id")
if [[ -n $env_files && $env_files != '<no value>' ]]; then
 IFS=',' read -r -a paths <<< "$env_files";for file in "${paths[@]}"; do [[ -f $file ]] || exit 1;envs+=(--env-file "$file");done
else
 for file in /srv/play-scout/deployment.env "$root/workspace.env";do [[ -f $file ]] && envs+=(--env-file "$file");done
fi
compose(){ d compose --project-name "$project" "${envs[@]}" "${args[@]}" --profile public "$@"; }
compose config --quiet
backup="$root/backups/assistant-update-$(date -u +%Y%m%dT%H%M%SZ)-$$";mkdir -m 700 "$backup"
git -C "$root/assistant" rev-parse HEAD > "$backup/source-ref"
d inspect --format '{{.Image}}' "$id" > "$backup/image"
image=$(d inspect --format '{{.Config.Image}}' "$id")
configured_image=$(compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["registration-assistant"].get("image",""))')
[[ $configured_image == "$image" ]] || { echo 'Образ в текущей конфигурации отличается от работающего. Требуется проверка перед обновлением.' >&2; exit 1; }
[[ -n $image && $image != sha256:* && $image != *@* ]] || { echo 'Образ помощника закреплён по digest. Требуется отдельная проверка его конфигурации.' >&2; exit 1; }
rollback(){
 local code=${1:-$?};trap - ERR INT TERM
 git -C "$root/assistant" checkout --detach "$(cat "$backup/source-ref")" || true
 d tag "$(cat "$backup/image")" "$image" || true
 compose up -d --no-build --no-deps --wait registration-assistant || true
 echo 'Обновление помощника не завершено; прежний образ возвращён. Проверьте журнал.' >&2
 exit "$code"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
git -C "$root/assistant" fetch --depth 1 origin registration-assistant
git -C "$root/assistant" checkout --detach FETCH_HEAD
echo 'Собираем только помощник. Play Scout и инструмент почты продолжают работать.'
d build -t "$image" "$root/assistant" > "$backup/build.log" 2>&1
compose up -d --no-build --no-deps --wait registration-assistant
trap - ERR INT TERM
echo 'Готово. Обновлён только помощник. Обновите его страницу и скачайте новую версию расширения.'
