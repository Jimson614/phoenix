#!/usr/bin/env bash
set -euo pipefail

targets=(
  /tmp/inspect_hba.sh
  /tmp/pg_hba.conf.audit
  /tmp/provision-phoenix-core-staging.sh
  /tmp/askwise-staging-core-readcheck
  /tmp/askwise-staging-core-readcheck.service
  /tmp/phoenix-core-staging.env
  /tmp/pg_hba.conf.askwise-staging
  /tmp/verify-phoenix-core-staging.sh
  /tmp/cleanup-phoenix-core-staging-temp.sh
)

for path in "${targets[@]}"; do
  resolved="$(realpath -m -- "$path")"
  case "$resolved" in
    /tmp/*) ;;
    *)
      echo "Refusing unsafe cleanup path: $resolved" >&2
      exit 70
      ;;
  esac
done

rm -f -- "${targets[@]}"

systemctl is-active postgresql.service
systemctl is-active askwise-staging-core-readcheck.service
systemctl show askwise-staging-core-readcheck.service \
  --property=Result,ExecMainStatus \
  --no-pager
