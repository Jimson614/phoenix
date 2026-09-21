#!/usr/bin/env bash
set -euo pipefail

readonly target_db="phoenix_core_staging"
readonly reader_role="askwise_staging_ro"
readonly service_name="askwise-staging-core-readcheck.service"

echo "=== database ==="
runuser -u postgres -- /usr/bin/psql -X -qAt -d postgres <<'SQL'
SELECT 'server_version|' || current_setting('server_version');
SELECT 'database|' || d.datname || '|' || pg_catalog.shobj_description(d.oid, 'pg_database')
FROM pg_database AS d
WHERE d.datname = 'phoenix_core_staging';
SELECT 'role|' || rolname || '|login=' || rolcanlogin || '|super=' || rolsuper ||
       '|createdb=' || rolcreatedb || '|createrole=' || rolcreaterole ||
       '|replication=' || rolreplication || '|bypassrls=' || rolbypassrls ||
       '|password_is_null=' || (rolpassword IS NULL)
FROM pg_authid
WHERE rolname IN ('askwise_staging_ro', 'phoenix_core_staging_owner')
ORDER BY rolname;
SELECT 'hba|' || line_number || '|' || type || '|' || array_to_string(database, ',') ||
       '|' || array_to_string(user_name, ',') || '|' || coalesce(address, '') ||
       '|' || auth_method || '|error=' || coalesce(error, '')
FROM pg_hba_file_rules
WHERE 'askwise_staging_ro' = ANY(user_name)
ORDER BY line_number;
SELECT 'hba_errors|' || count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;
SELECT 'listen_addresses|' || current_setting('listen_addresses');
SQL

echo "=== schema_guard ==="
runuser -u postgres -- /usr/bin/psql -X -qAt -d "$target_db" <<'SQL'
SELECT 'environment|' || current_setting('phoenix.environment', true);
SELECT 'user_schemas|' || coalesce(string_agg(schema_name, ',' ORDER BY schema_name), '')
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast');
SELECT 'user_tables|' || count(*)
FROM information_schema.tables
WHERE table_schema NOT IN ('information_schema', 'pg_catalog');
SQL

echo "=== service ==="
/usr/bin/systemctl is-enabled "$service_name"
/usr/bin/systemctl is-active "$service_name"
/usr/bin/systemctl show "$service_name" \
  --property=User,Group,ActiveState,SubState,Result,ExecMainStatus \
  --no-pager
/usr/bin/stat -c '%A|%U:%G|%n' \
  /etc/askwise-staging \
  /etc/askwise-staging/phoenix-core.env \
  /usr/local/libexec/askwise-staging-core-readcheck \
  /etc/systemd/system/askwise-staging-core-readcheck.service

echo "=== reader_probe ==="
runuser -u "$reader_role" -- /usr/bin/bash -c '
  set -a
  source /etc/askwise-staging/phoenix-core.env
  set +a
  exec /usr/local/libexec/askwise-staging-core-readcheck
'

if runuser -u "$reader_role" -- env \
  PGHOST=/var/run/postgresql \
  PGDATABASE=postgres \
  PGUSER="$reader_role" \
  /usr/bin/psql --no-password -X -qAt -c 'SELECT 1' >/dev/null 2>&1; then
  echo "other_database_rejected=no"
  exit 40
else
  echo "other_database_rejected=yes"
fi

if runuser -u "$reader_role" -- env \
  PGHOST=127.0.0.1 \
  PGPORT=5432 \
  PGDATABASE="$target_db" \
  PGUSER="$reader_role" \
  /usr/bin/psql --no-password -X -qAt -c 'SELECT 1' >/dev/null 2>&1; then
  echo "tcp_rejected=no"
  exit 41
else
  echo "tcp_rejected=yes"
fi
