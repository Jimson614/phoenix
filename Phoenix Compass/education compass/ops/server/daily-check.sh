#!/usr/bin/env bash
# 每天 05:00 由 cron 调用（备份 03:30、异地同步 04:10 之后）：检查今天的备份、异地同步、
# 证书剩余天数、磁盘，并汇总过去 24 小时的进程重启次数。
#
# 一切正常也会发一条「巡检正常」。这是有意的：告警系统最危险的故障是它自己坏了，
# 而"没有消息"既可能是一切正常，也可能是告警已经失灵。每天固定有一条，
# 哪天没收到就知道是告警本身出了问题。
#
# 可用环境变量覆盖（测试用）：PHOENIX_ALERT_STATE_DIR、PHOENIX_ALERT_CONFIG、PHOENIX_ALERT_DRY_RUN、
#   BACKUP_DIR、COS_LOG、CERT_HOST、CERT_MIN_DAYS、DISK_THRESHOLD、TODAY
set -uo pipefail

NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.20.0/bin
export PATH="$NODE_BIN:$PATH"
NOTIFY=("$NODE_BIN/node" "${PHOENIX_ALERT_NOTIFY:-/home/ubuntu/phoenix-alert-notify.mjs}")

STATE_DIR="${PHOENIX_ALERT_STATE_DIR:-$HOME/.local/state/phoenix-alert}"
CONFIG="${PHOENIX_ALERT_CONFIG:-$HOME/.config/phoenix-alert/feishu.env}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/db}"
COS_LOG="${COS_LOG:-$HOME/backups/db/cos-sync.log}"
CERT_HOST="${CERT_HOST:-api.phoenixnova.com.cn}"
# certbot 在到期前 30 天续期；还剩不到 20 天说明续期已经连续失败了至少 10 天。
CERT_MIN_DAYS="${CERT_MIN_DAYS:-20}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
TODAY="${TODAY:-$(date +%Y%m%d)}"
TODAY_DASH="${TODAY:0:4}-${TODAY:4:2}-${TODAY:6:2}"

mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
if [ ! -r "$CONFIG" ] && [ "${PHOENIX_ALERT_DRY_RUN:-}" != "1" ]; then exit 0; fi

problems=()
facts=()

# 1. 今天的备份
backups_ok=0
for db in compass phoenix_uat; do
  file=$(ls -t "$BACKUP_DIR"/"$db"-"$TODAY"-*.dump 2>/dev/null | head -1)
  if [ -n "$file" ] && [ -s "$file" ]; then
    backups_ok=$((backups_ok + 1))
  else
    problems+=("今天没有 $db 的备份（应在 03:30 生成）")
  fi
done
facts+=("备份 $backups_ok/2")

# 2. 今天的异地同步
if grep -q "^$TODAY_DASH .*成功" "$COS_LOG" 2>/dev/null; then
  facts+=("异地同步正常")
else
  last=$(tail -1 "$COS_LOG" 2>/dev/null)
  problems+=("今天没有成功的 COS 异地同步记录。日志最后一行：${last:-（日志为空）}")
fi

# 3. 证书：检查 nginx 实际对外提供的那张，而不是磁盘上的文件——
#    这样"续期成功但 nginx 没重载"也能发现。
end=$(echo | timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$CERT_HOST" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')
if [ -n "$end" ]; then
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  facts+=("证书剩 $days 天")
  if [ "$days" -lt "$CERT_MIN_DAYS" ]; then
    problems+=("HTTPS 证书只剩 $days 天，自动续期可能失败了。检查：sudo certbot renew --dry-run")
  fi
else
  problems+=("读不到 nginx 正在使用的证书（$CERT_HOST:443）")
fi

# 4. 磁盘
usage=$(df --output=pcent / | tail -1 | tr -dc '0-9')
facts+=("磁盘 ${usage}%")
if [ "${usage:-0}" -ge "$DISK_THRESHOLD" ]; then
  problems+=("磁盘使用 ${usage}%，超过 ${DISK_THRESHOLD}%")
fi

# 5. 过去 24 小时的进程重启（零星崩溃在这里汇总，崩溃循环由 health-check.sh 即时告警）
snapshot="$STATE_DIR/daily-restarts"
current=$(pm2 jlist 2>/dev/null | node -e "
  let s=''; process.stdin.on('data', d => s += d).on('end', () => {
    try { let t = 0; for (const p of JSON.parse(s)) if (p.name.startsWith('phoenix_uat')) t += p.pm2_env.restart_time; console.log(t) }
    catch { console.log('') }
  })")
if [ -n "$current" ]; then
  previous=$(cat "$snapshot" 2>/dev/null || echo "")
  echo "$current" > "$snapshot"
  if [ -n "$previous" ] && [ "$current" -ge "$previous" ]; then
    facts+=("24 小时内进程重启 $((current - previous)) 次")
  fi
fi

summary=$(IFS='，'; echo "${facts[*]}")
if [ "${#problems[@]}" -eq 0 ]; then
  "${NOTIFY[@]}" daily "每日巡检正常" "$summary"
else
  body=$(printf -- '- %s\n' "${problems[@]}")
  "${NOTIFY[@]}" alert "每日巡检发现 ${#problems[@]} 个问题" "$body
其余：$summary"
fi
