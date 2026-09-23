#!/usr/bin/env bash
# Switch the UAT backend (pm2: phoenix_uat_api) from mock login to real WeChat login.
# The AppSecret is read with hidden input; it is never echoed, logged or passed on a command line.
set -euo pipefail
umask 077

ENV_FILE="/home/ubuntu/education-compass/Phoenix Compass/education compass/server/.env.uat"
APP_ID="wxb2c1f04cec8d020a"
export PATH=/home/ubuntu/.nvm/versions/node/v24.20.0/bin:$PATH

read -rsp "请粘贴小程序 AppSecret（输入内容不会显示），然后按 Enter: " SECRET
echo
if [[ ! "$SECRET" =~ ^[0-9a-fA-F]{32}$ ]]; then
  echo "格式不对：AppSecret 应该是 32 位字母数字（0-9、a-f）。没有做任何修改。"
  exit 1
fi

BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$BACKUP"

# Rewrite the two keys via environment variables so the secret never appears in argv / ps.
TMP="$(mktemp "$ENV_FILE.XXXXXX")"
K_ID="$APP_ID" K_SECRET="$SECRET" awk '
  /^WECHAT_APP_ID=/     { print "WECHAT_APP_ID=" ENVIRON["K_ID"]; seen_id = 1; next }
  /^WECHAT_APP_SECRET=/ { print "WECHAT_APP_SECRET=" ENVIRON["K_SECRET"]; seen_secret = 1; next }
  { print }
  END {
    if (!seen_id) print "WECHAT_APP_ID=" ENVIRON["K_ID"]
    if (!seen_secret) print "WECHAT_APP_SECRET=" ENVIRON["K_SECRET"]
  }
' "$ENV_FILE" > "$TMP"
unset SECRET
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"

pm2 restart phoenix_uat_api >/dev/null
for _ in $(seq 1 20); do
  sleep 1
  curl -sf -m 2 http://127.0.0.1:3010/health >/dev/null && break
done

if curl -sf -m 5 http://127.0.0.1:3010/health >/dev/null; then
  pm2 save >/dev/null
  echo "完成：联调后端已改用真实微信登录，并已重启成功。"
else
  echo "联调后端没有正常启动。请告诉 Claude：\"联调后端配置 AppSecret 后没启动\"。"
  echo "修改前的配置备份在：$BACKUP"
  exit 1
fi
