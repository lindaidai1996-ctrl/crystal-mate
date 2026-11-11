#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
backup_image=${BACKUP_IMAGE:?Set BACKUP_IMAGE to the deployed migration image}
mkdir -p backups
backup_temp=$(mktemp "$project_dir/backups/.crystal-dev-XXXXXX")
trap 'rm -f "$backup_temp"' EXIT HUP INT TERM

docker compose --env-file .env.development-db.local -f compose.development.yaml \
    exec -T postgres pg_dump -U crystal_dev -d crystal_mate_dev \
    --format=custom --schema=public --no-owner --no-privileges > "$backup_temp"
docker compose --env-file .env.development-db.local -f compose.development.yaml \
    exec -T postgres pg_restore --list < "$backup_temp" > /dev/null

backup_name="crystal-dev-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
backup_file="$project_dir/backups/$backup_name"
mv "$backup_temp" "$backup_file"

docker run --rm --memory 256m \
    --env-file "$project_dir/.env.backup.local" \
    --mount "type=bind,src=$backup_file,dst=/backup.dump,readonly" \
    --mount "type=bind,src=$project_dir/deploy,dst=/app/deploy,readonly" \
    --entrypoint node "$backup_image" \
    /app/deploy/upload-backup.mjs /backup.dump "$backup_name"

# Keep two weeks locally, pruning only after the encrypted COS upload succeeds.
find "$project_dir/backups" -maxdepth 1 -type f \
    -name 'crystal-dev-????????T??????Z-*.dump' -mtime +14 -delete
