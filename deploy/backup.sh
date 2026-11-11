#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

backup_dir=${BACKUP_DIR:-"$project_dir/backups"}
mkdir -p "$backup_dir"
backup_temp=$(mktemp "$backup_dir/.crystal-XXXXXX")
trap 'rm -f "$backup_temp"' EXIT HUP INT TERM

docker compose --env-file .env.production -f compose.production.yaml \
    exec -T postgres pg_dump -U crystal -d crystal_mate \
    --format=custom --schema=public --no-owner --no-privileges > "$backup_temp"

# Detect truncated/invalid archives before marking a backup as complete.
docker compose --env-file .env.production -f compose.production.yaml \
    exec -T postgres pg_restore --list < "$backup_temp" > /dev/null

backup_file="$backup_dir/crystal-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
mv "$backup_temp" "$backup_file"
printf '%s\n' "$backup_file"
