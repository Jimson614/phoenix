#!/usr/bin/env bash
set -Eeuo pipefail

readonly target_db="phoenix_core_staging"
readonly owner_role="phoenix_core_staging_owner"
readonly reader_role="askwise_staging_ro"
readonly service_user="askwise_staging_ro"
readonly original_hba_sha="ad0df9635890926d79a12d5627b68af6b85b6254fa23cace2bbe077838969c9e"
readonly staged_hba="/tmp/pg_hba.conf.askwise-staging"
readonly staged_env="/tmp/phoenix-core-staging.env"
readonly staged_probe="/tmp/askwise-staging-core-readcheck"
readonly staged_unit="/tmp/askwise-staging-core-readcheck.service"

if [[ "$target_db" != "phoenix_core_staging" || "$owner_role" != "phoenix_core_staging_owner" || "$reader_role" != "askwise_staging_ro" ]]; then
  echo "Safety guard rejected unexpected identifiers" >&2
  exit 30
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 31
fi

for path in "$staged_hba" "$staged_env" "$staged_probe" "$staged_unit"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing staged asset: $path" >&2
    exit 32
  fi
done

if ! systemctl is-active --quiet postgresql.service; then
  echo "PostgreSQL is not active" >&2
  exit 33
fi

runuser -u postgres -- /usr/bin/psql -X -v ON_ERROR_STOP=1 -d postgres \
  -v owner_role="$owner_role" -v reader_role="$reader_role" <<'SQL'
SELECT format(
  'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'owner_role'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner_role')
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL',
  :'reader_role'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader_role')
\gexec

ALTER ROLE :"owner_role" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"reader_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
SQL

if ! runuser -u postgres -- /usr/bin/psql -X -qAt -d postgres \
  -c "SELECT 1 FROM pg_database WHERE datname = '$target_db'" | grep -qx '1'; then
  runuser -u postgres -- /usr/bin/createdb \
    --owner="$owner_role" \
    --template=template0 \
    --encoding=UTF8 \
    "$target_db"
fi

runuser -u postgres -- /usr/bin/psql -X -v ON_ERROR_STOP=1 -d postgres \
  -v target_db="$target_db" -v owner_role="$owner_role" -v reader_role="$reader_role" <<'SQL'
ALTER DATABASE :"target_db" OWNER TO :"owner_role";
ALTER DATABASE :"target_db" CONNECTION LIMIT 10;
REVOKE ALL PRIVILEGES ON DATABASE :"target_db" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE :"target_db" FROM :"reader_role";
GRANT CONNECT ON DATABASE :"target_db" TO :"reader_role";
ALTER DATABASE :"target_db" SET phoenix.environment TO 'staging';
COMMENT ON DATABASE :"target_db" IS 'NON-PRODUCTION: Phoenix Core staging; synthetic pilot data only';
ALTER ROLE :"reader_role" IN DATABASE :"target_db" SET default_transaction_read_only TO 'on';
ALTER ROLE :"reader_role" IN DATABASE :"target_db" SET statement_timeout TO '10s';
ALTER ROLE :"reader_role" IN DATABASE :"target_db" SET lock_timeout TO '2s';
ALTER ROLE :"reader_role" IN DATABASE :"target_db" SET idle_in_transaction_session_timeout TO '15s';
ALTER ROLE :"reader_role" IN DATABASE :"target_db" SET search_path TO core, public;
SQL

runuser -u postgres -- /usr/bin/psql -X -v ON_ERROR_STOP=1 -d "$target_db" \
  -v owner_role="$owner_role" -v reader_role="$reader_role" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM :"reader_role";
GRANT USAGE ON SCHEMA public TO :"reader_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" GRANT SELECT ON TABLES TO :"reader_role";
SQL

if ! getent group "$service_user" >/dev/null; then
  /usr/sbin/groupadd --system "$service_user"
fi

if ! getent passwd "$service_user" >/dev/null; then
  /usr/sbin/useradd \
    --system \
    --gid "$service_user" \
    --home-dir /var/lib/askwise-staging \
    --create-home \
    --shell /usr/sbin/nologin \
    "$service_user"
fi

/usr/bin/install -d -o root -g "$service_user" -m 0750 /etc/askwise-staging
/usr/bin/install -d -o root -g root -m 0755 /usr/local/libexec
/usr/bin/install -o root -g "$service_user" -m 0640 "$staged_env" /etc/askwise-staging/phoenix-core.env
/usr/bin/install -o root -g root -m 0755 "$staged_probe" /usr/local/libexec/askwise-staging-core-readcheck
/usr/bin/install -o root -g root -m 0644 "$staged_unit" /etc/systemd/system/askwise-staging-core-readcheck.service

current_hba_sha="$(sha256sum /etc/postgresql/16/main/pg_hba.conf | awk '{print $1}')"
new_hba_sha="$(sha256sum "$staged_hba" | awk '{print $1}')"
hba_backup=""
if [[ "$current_hba_sha" != "$new_hba_sha" ]]; then
  if [[ "$current_hba_sha" != "$original_hba_sha" ]]; then
    echo "pg_hba.conf changed after audit; refusing to overwrite" >&2
    exit 34
  fi
  backup="/etc/postgresql/16/main/pg_hba.conf.askwise-backup.$(date -u +%Y%m%dT%H%M%SZ)"
  /usr/bin/install -o postgres -g postgres -m 0640 /etc/postgresql/16/main/pg_hba.conf "$backup"
  /usr/bin/install -o postgres -g postgres -m 0640 "$staged_hba" /etc/postgresql/16/main/pg_hba.conf
  hba_backup="$backup"
fi

hba_errors="$(runuser -u postgres -- /usr/bin/psql -X -qAt -d postgres -c \
  "SELECT coalesce(string_agg(line_number::text || ':' || error, E'\\n'), '') FROM pg_hba_file_rules WHERE error IS NOT NULL")"
if [[ -n "$hba_errors" ]]; then
  echo "Invalid pg_hba.conf:" >&2
  printf '%s\n' "$hba_errors" >&2
  if [[ -n "$hba_backup" ]]; then
    /usr/bin/install -o postgres -g postgres -m 0640 "$hba_backup" /etc/postgresql/16/main/pg_hba.conf
  fi
  exit 35
fi

if [[ "$(runuser -u postgres -- /usr/bin/psql -X -qAt -d postgres -c 'SELECT pg_reload_conf()')" != "t" ]]; then
  echo "PostgreSQL configuration reload failed" >&2
  if [[ -n "$hba_backup" ]]; then
    /usr/bin/install -o postgres -g postgres -m 0640 "$hba_backup" /etc/postgresql/16/main/pg_hba.conf
    runuser -u postgres -- /usr/bin/psql -X -qAt -d postgres -c 'SELECT pg_reload_conf()' >/dev/null || true
  fi
  exit 36
fi

/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable --now askwise-staging-core-readcheck.service

echo "Provisioned Phoenix Core staging read-only connectivity"
