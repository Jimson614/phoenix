#!/usr/bin/env bash
# Copy local database dumps to Tencent COS and prune remote copies older than RETENTION_DAYS.
# Configured by ~/set-cos-backup.sh; credentials live in ~/.config/rclone/rclone.conf (owner-only).
set -uo pipefail
umask 077

DIR=/home/ubuntu/backups/db
LOG="$DIR/cos-sync.log"
BUCKET_FILE=/home/ubuntu/.config/phoenix-cos-bucket
REMOTE=cos
RETENTION_DAYS=30

log() { printf '%s %s\n' "$(date '+%F %T')" "$1" >> "$LOG"; }

if [ ! -r "$BUCKET_FILE" ]; then
  log "失败：尚未配置 COS，请先运行 ~/set-cos-backup.sh"
  exit 1
fi
BUCKET="$(cat "$BUCKET_FILE")"

if ! output="$(rclone copy "$DIR" "$REMOTE:$BUCKET/db" --include '*.dump' --transfers 2 --stats 0 2>&1)"; then
  log "失败：上传出错 $(printf '%s' "$output" | tail -1)"
  exit 1
fi

remote_count="$(rclone lsf "$REMOTE:$BUCKET/db" --include '*.dump' 2>/dev/null | wc -l)"
remote_size="$(rclone size "$REMOTE:$BUCKET/db" --json 2>/dev/null | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
log "成功：云端现有 ${remote_count} 个备份，共 $(( ${remote_size:-0} / 1024 )) KB"

if pruned="$(rclone delete "$REMOTE:$BUCKET/db" --min-age "${RETENTION_DAYS}d" --include '*.dump' 2>&1)"; then
  [ -n "$pruned" ] && log "清理：删除超过 ${RETENTION_DAYS} 天的云端备份"
else
  log "警告：清理旧备份失败 $(printf '%s' "$pruned" | tail -1)"
fi

if [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 524288 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
