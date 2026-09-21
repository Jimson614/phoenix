#!/usr/bin/env bash
set -euo pipefail

sudo -n -u postgres psql -X -Atqc "SHOW hba_file; SHOW unix_socket_directories;"
sudo -n awk '
  BEGIN { OFS=" " }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  { print $1, $2, $3, $4, $5 }
' /etc/postgresql/16/main/pg_hba.conf

sudo -n -u postgres psql -X -Atqc "
  SELECT 'db|' || datname
  FROM pg_database
  WHERE datname = 'phoenix_core_staging';
  SELECT 'role|' || rolname
  FROM pg_roles
  WHERE rolname IN ('phoenix_core_staging_owner', 'askwise_staging_ro')
  ORDER BY rolname;
"

if test -e /etc/askwise-staging/phoenix-core.env; then
  echo config_exists=yes
else
  echo config_exists=no
fi

if test -e /etc/systemd/system/askwise-staging-core-readcheck.service; then
  echo unit_exists=yes
else
  echo unit_exists=no
fi

if getent passwd askwise_staging_ro >/dev/null; then
  echo user_exists=yes
else
  echo user_exists=no
fi
