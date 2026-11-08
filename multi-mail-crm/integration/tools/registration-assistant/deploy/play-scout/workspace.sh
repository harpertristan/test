#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo.' >&2; exit 1; }
root=/srv/play-scout-workspace
args=()
while IFS= read -r file; do args+=(-f "$file"); done < "$root/base-files.list"
d(){ env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
compose(){ d compose --project-name play-scout --env-file /srv/play-scout/deployment.env --env-file "$root/workspace.env" "${args[@]}" -f "$root/compose.yaml" --profile public "$@"; }
case "${1:-status}" in status|logs) ;; *) exec 9>"$root/install.lock"; flock -n 9 || { echo 'Уже выполняется обслуживание. Дождитесь завершения.' >&2; exit 1; };; esac
case "${1:-status}" in
 status) compose ps;;
 logs) compose logs --tail 60 app registration-assistant caddy;;
 start)
  backup=$(cat "$root/last-backup")
  if [[ -f $backup/backup-service-present ]]; then
   mkdir -p /etc/systemd/system/play-scout-backup.service.d
   printf '[Service]\nExecStart=\nExecStart=/bin/bash /srv/play-scout-workspace/workspace.sh backup-and-start\n' > /etc/systemd/system/play-scout-backup.service.d/workspace.conf
   systemctl daemon-reload
  fi
  compose up -d --no-build --no-deps --wait app registration-assistant caddy;;
 stop) compose stop app registration-assistant;;
 backup-and-start)
  test -s /srv/play-scout/data/state.json
  test -s "$root/assistant-data/assistant.sqlite"
  snapshot="$root/backups/data-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -m 700 "$snapshot"
  restart_on_error(){ compose up -d --no-build --no-deps --wait app registration-assistant || true; }
  trap restart_on_error ERR
  compose stop app registration-assistant
  tar -C /srv/play-scout -czf "$snapshot/play-scout.tar.gz" data app.env
  tar -C "$root" -czf "$snapshot/assistant.tar.gz" assistant-data workspace.env compose.yaml base-files.list
  tar -tzf "$snapshot/play-scout.tar.gz" >/dev/null
  tar -tzf "$snapshot/assistant.tar.gz" >/dev/null
  compose up -d --no-build --no-deps --wait app registration-assistant
  trap - ERR
  printf '%s\n' "$snapshot" > "$root/last-data-backup"
  echo "Копия CRM и помощника создана: $snapshot";;
 rollback)
  backup=$(cat "$root/last-backup")
  compose stop registration-assistant
  # Code/storage formats are preserved; this returns the original app and proxy.
  d compose --project-name play-scout --env-file "$backup/deployment.env" -f "$backup/compose.yaml" -f "$backup/rollback.json" --profile public up -d --no-build --no-deps app caddy
  if [[ -f $backup/backup-service-present ]]; then
   if [[ -f $backup/backup-unit.original ]]; then cp "$backup/backup-unit.original" /etc/systemd/system/play-scout-backup.service.d/workspace.conf; else rm -f /etc/systemd/system/play-scout-backup.service.d/workspace.conf; fi
   systemctl daemon-reload
  fi
  echo 'Прежний интерфейс Play Scout возвращён. Данные помощника сохранены.';;
 *) echo 'Команды: status, logs, start, stop, backup-and-start, rollback' >&2; exit 1;;
esac
