#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/crm-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
temporary="$file.tmp"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
docker compose exec -T postgres sh -c 'exec pg_dump --format=custom --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' > "$temporary"
test -s "$temporary"
mv "$temporary" "$file"
trap - EXIT HUP INT TERM
printf 'Backup saved: %s\n' "$file"
