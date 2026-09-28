#!/usr/bin/env bash
# 每 2 分钟由 cron 调用：检查联调后端、公网入口、生产后端（启用后），以及进程是否在反复崩溃重启。
#
# 只在状态变化时通知：连续失败达到阈值发一次「告警」，恢复时发一次「恢复」，中间不重复刷屏。
# 发送失败时不记状态，下一轮会重试，避免"以为已经通知过了"。
#
# 可用环境变量覆盖（测试用）：PHOENIX_ALERT_STATE_DIR、PHOENIX_ALERT_CONFIG、PHOENIX_ALERT_DRY_RUN、
#   HEALTH_LOCAL_URL、HEALTH_PUBLIC_URL、HEALTH_PROD_URL、HEALTH_FAIL_THRESHOLD、RESTART_ALERT_DELTA
set -uo pipefail

NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.20.0/bin
export PATH="$NODE_BIN:$PATH"
NOTIFY=("$NODE_BIN/node" "${PHOENIX_ALERT_NOTIFY:-/home/ubuntu/phoenix-alert-notify.mjs}")

STATE_DIR="${PHOENIX_ALERT_STATE_DIR:-$HOME/.local/state/phoenix-alert}"
CONFIG="${PHOENIX_ALERT_CONFIG:-$HOME/.config/phoenix-alert/feishu.env}"
LOCAL_URL="${HEALTH_LOCAL_URL:-http://127.0.0.1:3010/health}"
PUBLIC_URL="${HEALTH_PUBLIC_URL:-https://api.phoenixnova.com.cn/health}"
PROD_URL="${HEALTH_PROD_URL:-http://127.0.0.1:3100/health}"
# 2 次：一次抖动不报，持续 2~4 分钟的中断一定报。
FAIL_THRESHOLD="${HEALTH_FAIL_THRESHOLD:-2}"
# 部署会让每个进程正好重启 1 次，所以 2 分钟内重启 3 次以上才算崩溃循环。
# 零星的单次崩溃不在这里报，而是在每日巡检里汇总。
RESTART_ALERT_DELTA="${RESTART_ALERT_DELTA:-3}"

mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
LOG="$STATE_DIR/health.log"

# 还没配置告警通道时安静退出，不要让 cron 每两分钟产生一堆错误。
if [ ! -r "$CONFIG" ] && [ "${PHOENIX_ALERT_DRY_RUN:-}" != "1" ]; then exit 0; fi

log() {
  echo "$(date '+%F %T') $*" >> "$LOG"
  if [ "$(wc -l < "$LOG")" -gt 4000 ]; then tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}

notify() { "${NOTIFY[@]}" "$@" >> "$LOG" 2>&1; }

check_url() {
  local name="$1" url="$2" label="$3"
  local fails_file="$STATE_DIR/$name.fails" down_file="$STATE_DIR/$name.down"
  local code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url" 2>/dev/null) || true
  [ -n "$code" ] || code=000

  if [ "$code" = "200" ]; then
    if [ -f "$down_file" ]; then
      local since; since=$(cat "$down_file")
      if notify recovery "$label 已恢复" "故障开始于 $since，健康检查现在返回 200。"; then
        rm -f "$down_file"; log "$name 恢复"
      fi
    fi
    rm -f "$fails_file"
    return
  fi

  local n; n=$(( $(cat "$fails_file" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$fails_file"
  if [ "$n" -ge "$FAIL_THRESHOLD" ] && [ ! -f "$down_file" ]; then
    local when; when=$(date '+%F %T')
    if notify alert "$label 不可用" "健康检查连续 $n 次失败（HTTP $code）：$url"; then
      echo "$when" > "$down_file"; log "$name 故障 HTTP $code"
    fi
  fi
}

check_restarts() {
  local list
  list=$(pm2 jlist 2>/dev/null | node -e "
    let s=''; process.stdin.on('data', d => s += d).on('end', () => {
      try { for (const p of JSON.parse(s)) if (p.name.startsWith('phoenix_uat')) console.log(p.name + ' ' + p.pm2_env.restart_time) }
      catch { }
    })") || return
  # pm2 本身不响应时，进程是否活着交给上面的 HTTP 检查判断。
  [ -n "$list" ] || return
  while read -r name count; do
    local file="$STATE_DIR/restarts.$name"
    local prev; prev=$(cat "$file" 2>/dev/null || echo "")
    echo "$count" > "$file"
    # 第一次运行只记基线；计数变小说明 pm2 被重置过，同样只记基线。
    [ -n "$prev" ] && [ "$count" -ge "$prev" ] || continue
    local delta=$(( count - prev ))
    if [ "$delta" -ge "$RESTART_ALERT_DELTA" ]; then
      notify alert "$name 在反复崩溃重启" "过去约 2 分钟内重启了 $delta 次（累计 $count 次）。查看：pm2 logs $name --lines 50" \
        && log "$name 崩溃循环 +$delta"
    fi
  done <<< "$list"
}

check_url local "$LOCAL_URL" "联调后端（本机 3010）"
check_url public "$PUBLIC_URL" "公网入口 api.phoenixnova.com.cn"
# 生产服务启用之后自动纳入监控，不用再改这个脚本。
if systemctl is-active --quiet education-compass.service 2>/dev/null; then
  check_url prod "$PROD_URL" "生产后端（本机 3100）"
fi
check_restarts
