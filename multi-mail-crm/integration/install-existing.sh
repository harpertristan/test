#!/usr/bin/env bash
# Add only the new CRM and replace the shared proxy config. Never rebuild old apps.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo на VPS.' >&2; exit 1; }
crm=$(cd "$(dirname "$0")/.." && pwd)
workspace=${WORKSPACE_DIR:-/srv/play-scout-workspace}
scout=${SCOUT_DIR:-/srv/play-scout}
public_url=${1:?Укажите существующий HTTPS origin первым аргументом}
for file in "$workspace/base-files.list" "$workspace/compose.yaml" "$workspace/workspace.env" "$scout/deployment.env"; do
  [[ -f $file ]] || { echo "Нет существующего файла: $file" >&2; exit 1; }
done
exec 9>"$workspace/install.lock"
flock -n 9 || { echo 'Сейчас выполняется другое обслуживание рабочего пространства.' >&2; exit 1; }
base=()
while IFS= read -r file; do [[ -n $file ]] && base+=(-f "$file"); done < "$workspace/base-files.list"
d(){ env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
old(){ d compose --project-name play-scout --env-file "$scout/deployment.env" --env-file "$workspace/workspace.env" "${base[@]}" -f "$workspace/compose.yaml" --profile public "$@"; }
new(){ d compose --project-name multi-mail-crm --env-file "$crm/.env" -f "$crm/docker-compose.yml" -f "$crm/integration/compose.existing.yml" "$@"; }
app_id=$(old ps -q app)
assistant_id=$(old ps -q registration-assistant)
caddy_id=$(old ps -q caddy)
[[ -n $app_id && -n $assistant_id && -n $caddy_id ]] || { echo 'Сначала восстановите работу существующих app, registration-assistant и caddy.' >&2; exit 1; }
python3 "$crm/scripts/verify_tool_sources.py"
python3 "$crm/scripts/verify_tool_sources.py" --installed "$workspace"
python3 "$crm/integration/prepare_existing.py" --workspace "$workspace" --scout "$scout" --public-url "$public_url"
state="$workspace/mail-crm-integration/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$state"
d inspect --format '{{.Id}} {{.Image}}' "$app_id" "$assistant_id" > "$state/old-apps.before"
d cp "$caddy_id:/etc/caddy/Caddyfile" "$state/previous.Caddyfile" >/dev/null
python3 - "$state" "$crm" <<'PY'
import json,sys
from pathlib import Path
state,crm=map(Path,sys.argv[1:])
for name,source in [('new',crm/'integration/Caddyfile'),('rollback',state/'previous.Caddyfile')]:
 config={'services':{'caddy':{'volumes':[{'type':'bind','source':str(source),'target':'/etc/caddy/Caddyfile','read_only':True}]}}}
 (state/(name+'.json')).write_text(json.dumps(config))
PY
old -f "$state/new.json" config --quiet
new config --quiet
if [[ -n $(d ps -q --filter label=com.docker.compose.project=multi-mail-crm --filter label=com.docker.compose.service=app) || -n $(d ps -q --filter label=com.docker.compose.project=multi-mail-crm --filter label=com.docker.compose.service=registration-assistant) ]]; then
  echo 'В новом проекте уже запущены демо-копии старых приложений. Не смешивайте integrated и existing; остановите демо-копии без удаления томов.' >&2
  exit 1
fi
new up --build -d --wait --wait-timeout 180
# Validate with the existing Caddy environment; never dump resolved config/secrets.
d cp "$crm/integration/Caddyfile" "$caddy_id:/tmp/mail-crm.Caddyfile" >/dev/null
old exec -T caddy caddy validate --config /tmp/mail-crm.Caddyfile --adapter caddyfile
rollback(){
  echo 'Проверка не прошла: возвращаю предыдущую конфигурацию только Caddy.' >&2
  old -f "$state/rollback.json" up -d --no-build --no-deps caddy || true
  echo "Исходные приложения и их данные не удалялись. Конфигурация отката: $state/rollback.json" >&2
}
trap rollback ERR
old -f "$state/new.json" up -d --no-build --no-deps caddy
[[ $(old ps -q app) == "$app_id" && $(old ps -q registration-assistant) == "$assistant_id" ]]
d inspect --format '{{.Id}} {{.Image}}' "$app_id" "$assistant_id" > "$state/old-apps.after"
cmp "$state/old-apps.before" "$state/old-apps.after"
curl --fail --silent --show-error --retry 8 --retry-delay 3 --retry-all-errors "$public_url/mail-crm/api/health/ready" > "$state/new-crm-health.json"
trap - ERR
printf '%s\n' "$state/new.json" > "$workspace/mail-crm-integration/active-override"
printf 'Третья вкладка добавлена: %s/mail-crm/\n' "$public_url"
printf 'Контейнеры и образы двух прежних приложений не изменились. Override для дальнейшего обслуживания Caddy: %s\n' "$state/new.json"
printf 'Откат — прежние compose-аргументы с -f %s up -d --no-build --no-deps caddy\n' "$state/rollback.json"
