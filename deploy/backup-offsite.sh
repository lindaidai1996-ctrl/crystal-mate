#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

backup_file=$(sh deploy/backup.sh)
backup_name=$(basename "$backup_file")
backup_image=${BACKUP_IMAGE:?Set BACKUP_IMAGE to the deployed migration image}

docker run --rm --memory 256m \
    --env-file "$project_dir/.env.backup.local" \
    --mount "type=bind,src=$backup_file,dst=/backup.dump,readonly" \
    --mount "type=bind,src=$project_dir/deploy,dst=/app/deploy,readonly" \
    --entrypoint node "$backup_image" \
    /app/deploy/upload-backup.mjs /backup.dump "$backup_name"

# Prune only timestamped local backups, and only after a successful COS upload.
find "$project_dir/backups" -maxdepth 1 -type f \
    -name 'crystal-????????T??????Z-*.dump' -mtime +14 -delete
