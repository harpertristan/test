#!/usr/bin/env bash
# Run on the VM with sudo. No application credentials are printed.
set -euo pipefail
umask 077
root=/srv/play-scout
code="$root/code"
[[ ${EUID} -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
cd "$code"
compose() {
  local files=(-f "$code/deploy/google-cloud/compose.yaml")
  if grep -Eq '^PLAY_SCOUT_ACCELERATOR=cpu\r?$' "$root/deployment.env"; then
    files+=(-f "$code/deploy/google-cloud/compose.cpu.yaml")
  fi
  docker compose --env-file "$root/deployment.env" "${files[@]}" "$@"
}
check_credentials() {
  test -f "$root/app.env"
  # Read using Node's own dotenv parser, not shell evaluation.
  compose run --rm --no-deps --entrypoint node app --input-type=module -e '
    import {parseEnv} from "node:util"; import {readFileSync} from "node:fs";
    const e=parseEnv(readFileSync("/app/.env","utf8"));
    if(!e.APP_PASSWORD || e.APP_PASSWORD.length<12)throw Error("Set APP_PASSWORD with at least 12 characters");
    if(e.VIEW_PASSWORD && (e.VIEW_PASSWORD.length<12 || e.VIEW_PASSWORD===e.APP_PASSWORD))throw Error("VIEW_PASSWORD must be different and at least 12 characters");
    console.log("Application access configuration checked; no credential values displayed.");'
}
backup() {
  test -s "$root/data/state.json"
  mkdir -p "$root/backups"
  local target="$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir "$target"
  local id
  id=$(compose ps -a -q app)
  if [[ -n "$id" ]]; then docker inspect --format '{{.Image}}' "$id" > "$target/image-id"; fi
  cp "$root/deployment.env" "$target/deployment.env"
  compose config > "$target/compose.yaml"
  cp deploy/google-cloud/Caddyfile "$target/Caddyfile"
  tar -C "$root" -czf "$target/profile.tar.gz" data app.env
  tar -tzf "$target/profile.tar.gz" >/dev/null
  printf '%s\n' "$target" > "$root/last-backup"
  echo "Consistent stopped-instance backup: $target"
}
case "${1:-help}" in
  build)
    compose build app
    check_credentials
    ;;
  start)
    check_credentials
    compose up -d --wait --wait-timeout 180 ollama app
    curl --fail --silent --show-error http://127.0.0.1:3000/api/health
    ;;
  public)
    check_credentials
    compose --profile public up -d --wait --wait-timeout 180
    echo 'Check the HTTPS domain separately; running Caddy is not proof of certificate readiness.'
    ;;
  stop) compose stop app ;;
  status) compose ps ;;
  logs) compose logs --tail 80 app caddy ;;
  doctor) compose run --rm --no-deps app node scripts/doctor.js --storage ;;
  backup)
    compose stop app
    backup
    echo 'App remains stopped. Restart with server.sh start (or public).'
    ;;
  backup-and-start)
    if bash "$code/deploy/google-cloud/server.sh" backup; then
      compose up -d --wait --wait-timeout 180 ollama app
    else
      compose up -d --wait --wait-timeout 180 ollama app
      echo 'Backup failed; application restart attempted. Inspect logs and disk space.' >&2
      exit 1
    fi
    ;;
  update)
    # Refuse local tracked or untracked edits; .env/data live outside Git.
    [[ -z "$(git status --porcelain)" ]] || { echo 'Checkout has local changes; preserve/review them before updating.' >&2; exit 1; }
    git fetch origin main
    git merge --ff-only origin/main
    next=$(git rev-parse HEAD)
    docker build -t "play-scout:$next" .
    compose stop app
    backup
    sed -i "s/^PLAY_SCOUT_IMAGE_TAG=.*/PLAY_SCOUT_IMAGE_TAG=$next/" "$root/deployment.env"
    if ! check_credentials || ! compose up -d --wait --wait-timeout 180 ollama app; then
      echo 'Update failed; app stopped. Backup path is in /srv/play-scout/last-backup. Use documented rollback.' >&2
      compose stop app
      exit 1
    fi
    curl --fail --silent --show-error http://127.0.0.1:3000/api/health
    ;;
  *) echo 'Usage: sudo bash deploy/google-cloud/server.sh {build|start|public|stop|status|logs|doctor|backup|backup-and-start|update}' ;;
esac
