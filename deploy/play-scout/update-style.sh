#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo bash.' >&2; exit 1; }
root=/srv/play-scout-workspace
[[ -f $root/installed ]] || { echo 'Общая панель не установлена.' >&2; exit 1; }
exec 9>"$root/install.lock"
flock -n 9 || { echo 'Выполняется обслуживание. Повторите позже.' >&2; exit 1; }
for folder in scout assistant; do
 [[ -z $(git -C "$root/$folder" status --porcelain) ]] || { echo "Есть локальные изменения: $folder. Обновление остановлено." >&2; exit 1; }
done
args=()
while IFS= read -r file; do args+=(-f "$file"); done < "$root/base-files.list"
d(){ env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
compose(){ d compose --project-name play-scout --env-file /srv/play-scout/deployment.env --env-file "$root/workspace.env" "${args[@]}" -f "$root/compose.yaml" --profile public "$@"; }
backup="$root/backups/style-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -m 700 "$backup"
for folder in scout assistant; do git -C "$root/$folder" rev-parse HEAD > "$backup/$folder-ref"; done
for service in app registration-assistant; do d inspect --format '{{.Image}}' "$(compose ps -q "$service")" > "$backup/$service-image"; done
python3 - "$backup" <<'PY'
import pathlib,sys,json
p=pathlib.Path(sys.argv[1]);(p/'images.json').write_text(json.dumps({'services':{name:{'image':(p/(name+'-image')).read_text().strip()} for name in ['app','registration-assistant']}}))
PY
rollback(){
 local code=$?
 trap - ERR
 for folder in scout assistant; do git -C "$root/$folder" checkout --detach "$(cat "$backup/$folder-ref")" || true; done
 compose -f "$backup/images.json" up -d --no-build --no-deps --wait app registration-assistant || true
 echo 'Обновление не завершено. Предыдущие образы возвращены; данные сохранены.' >&2
 exit "$code"
}
trap rollback ERR
for pair in 'scout play-scout-workspace' 'assistant registration-assistant'; do
 read -r folder branch <<< "$pair"
 git -C "$root/$folder" fetch --depth 1 origin "$branch"
 git -C "$root/$folder" checkout --detach FETCH_HEAD
done
compose build app registration-assistant > "$backup/build.log" 2>&1
compose up -d --no-build --no-deps --wait app registration-assistant
trap - ERR
echo 'Готово. Фиолетовое оформление включится после обновления страницы. Документы и ключи сохранены.'
