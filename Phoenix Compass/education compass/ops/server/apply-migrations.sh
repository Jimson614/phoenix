#!/usr/bin/env bash
# Apply pending Education Compass migrations to a local database as the postgres superuser and
# record them in schema_migrations, using the same table and checksums as server/scripts/migrate.js.
# The application role keeps data-only privileges, so it never needs DDL rights.
# Usage: ~/apply-migrations.sh [database]   (default: phoenix_uat)
set -euo pipefail

DB="${1:-phoenix_uat}"
DIR="/home/ubuntu/education-compass/Phoenix Compass/education compass/server/migrations"
NODE=/home/ubuntu/.nvm/versions/node/v24.20.0/bin/node

psqlq() { sudo -n -u postgres psql -tAq -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

psqlq -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())" > /dev/null

applied=0
for file in "$DIR"/[0-9][0-9][0-9]_*.sql; do
  name="$(basename "$file")"
  sum="$(sha256sum "$file" | cut -d' ' -f1)"
  recorded="$(psqlq -c "select checksum from schema_migrations where name = '$name'")"
  if [ -n "$recorded" ]; then
    if [ "$recorded" != "$sum" ]; then
      echo "已应用的迁移文件被改动过，已停止：$name"
      exit 1
    fi
    echo "已应用：$name"
    continue
  fi
  tmp="$(mktemp /tmp/phoenix-migration-XXXXXX.sql)"
  chmod 644 "$tmp"
  # Strip the file's own BEGIN/COMMIT so the DDL and its record commit together.
  "$NODE" -e '
    const fs = require("fs")
    const raw = fs.readFileSync(process.argv[1], "utf8")
    fs.writeFileSync(process.argv[2], raw.replace(/^\s*BEGIN\s*;\s*/i, "").replace(/\s*COMMIT\s*;\s*$/i, "\n"))
  ' "$file" "$tmp"
  echo "正在应用：$name"
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 --single-transaction -q -d "$DB" \
    -f "$tmp" -c "INSERT INTO schema_migrations(name, checksum) VALUES ('$name', '$sum')"
  rm -f "$tmp"
  applied=$((applied + 1))
  echo "已完成：$name"
done

echo "本次新应用 $applied 个；数据库 $DB 当前记录 $(psqlq -c 'select count(*) from schema_migrations') 个迁移。"
