#!/usr/bin/env bash
# Daily custom-format dumps of the Education Compass databases.
# Dumps contain personal data: the directory and files stay owner-only.
set -uo pipefail
umask 077

DIR=/home/ubuntu/backups/db
RETENTION_DAYS=14
DATABASES=(compass phoenix_uat)
LOG="$DIR/backup.log"

mkdir -p "$DIR"
chmod 700 "$DIR"
log() { printf '%s %s\n' "$(date '+%F %T')" "$1" >> "$LOG"; }

status=0
for db in "${DATABASES[@]}"; do
  out="$DIR/${db}-$(date +%Y%m%d-%H%M%S).dump"
  if ! sudo -n -u postgres pg_dump -Fc "$db" > "$out" 2>>"$LOG"; then
    rm -f "$out"
    log "失败：$db 备份未完成"
    status=1
    continue
  fi
  # A dump that pg_restore cannot list is not a usable backup.
  if ! pg_restore -l "$out" > /dev/null 2>>"$LOG"; then
    rm -f "$out"
    log "失败：$db 备份文件校验不通过，已删除"
    status=1
    continue
  fi
  log "成功：$db -> $(basename "$out") ($(du -h "$out" | cut -f1))"
done

removed=$(find "$DIR" -maxdepth 1 -name '*.dump' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
[ "$removed" -gt 0 ] && log "清理：删除 $removed 个超过 ${RETENTION_DAYS} 天的备份"

# Keep the log small without needing logrotate.
if [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 524288 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit "$status"
