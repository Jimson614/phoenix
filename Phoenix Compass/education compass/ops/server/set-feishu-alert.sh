#!/usr/bin/env bash
# 配置飞书群机器人告警通道。
#
#   ~/set-feishu-alert.sh           录入 webhook 与 secret（隐藏输入），发测试消息，成功后装定时任务
#   ~/set-feishu-alert.sh --test    用已保存的配置再发一条测试消息
#
# 测试消息发不出去就不装定时任务、也不覆盖原配置：装了 cron 却发不出消息，
# 比没装更糟——它会让人以为有告警。
set -euo pipefail
umask 077

NODE=/home/ubuntu/.nvm/versions/node/v24.20.0/bin/node
NOTIFY=/home/ubuntu/phoenix-alert-notify.mjs
CONFIG_DIR="$HOME/.config/phoenix-alert"
CONFIG="$CONFIG_DIR/feishu.env"
CRON_HEALTH="*/2 * * * * /home/ubuntu/health-check.sh >/dev/null 2>&1"
CRON_DAILY="0 5 * * * /home/ubuntu/daily-check.sh >/dev/null 2>&1"

send_test() {
  "$NODE" "$NOTIFY" test "告警通道已接通" \
    "以后后端不可用、进程反复崩溃、备份或证书出问题时会在这里通知。每天 05:00 会收到一条巡检消息——哪天没收到，说明告警本身出了问题。"
}

if [ "${1:-}" = "--test" ]; then
  [ -r "$CONFIG" ] || { echo "还没有配置，先不带参数运行一次。"; exit 1; }
  send_test && echo "测试消息已发送，去飞书群里看一眼。"
  exit
fi

echo "在飞书群里：设置 → 群机器人 → 添加机器人 → 自定义机器人。"
echo "安全设置建议勾选「签名校验」并复制 secret；如果用「自定义关键词」，关键词填 Phoenix。"
echo
read -rsp "粘贴 webhook 地址（输入不显示），然后按 Enter: " WEBHOOK
echo
if [[ ! "$WEBHOOK" =~ ^https://open\.(feishu\.cn|larksuite\.com)/open-apis/bot/v2/hook/[A-Za-z0-9-]+$ ]]; then
  echo "格式不对：应形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxx 。没有做任何修改。"
  exit 1
fi
read -rsp "粘贴签名校验的 secret（用关键词校验的话直接按 Enter 留空）: " SECRET
echo

mkdir -p "$CONFIG_DIR" && chmod 700 "$CONFIG_DIR"
TMP="$(mktemp "$CONFIG_DIR/feishu.env.XXXXXX")"
# printf 是 bash 内建命令，值不会出现在进程参数里。
printf 'FEISHU_ALERT_WEBHOOK=%s\nFEISHU_ALERT_SECRET=%s\n' "$WEBHOOK" "$SECRET" > "$TMP"
unset WEBHOOK SECRET
chmod 600 "$TMP"

# 先用新配置试发，成功了才替换旧配置。
if ! PHOENIX_ALERT_CONFIG="$TMP" "$NODE" "$NOTIFY" test "告警通道已接通" \
    "以后后端不可用、进程反复崩溃、备份或证书出问题时会在这里通知。每天 05:00 会收到一条巡检消息——哪天没收到，说明告警本身出了问题。"; then
  rm -f "$TMP"
  echo "测试消息没有发出去，原配置未改动、定时任务未安装。按上面的原因调整机器人设置后重试。"
  exit 1
fi
mv "$TMP" "$CONFIG"

# 只替换本脚本管理的两行，保留备份等其他定时任务。
( crontab -l 2>/dev/null | grep -vF '/home/ubuntu/health-check.sh' | grep -vF '/home/ubuntu/daily-check.sh'
  echo "$CRON_HEALTH"
  echo "$CRON_DAILY" ) | crontab -

echo "完成：测试消息已发送到飞书群，定时任务已安装。"
echo "  健康检查：每 2 分钟"
echo "  每日巡检：每天 05:00"
