#!/usr/bin/env bash
# 录入 / 体检小程序虚拟支付和消息推送配置。
#
# 秘密值（AppKey、消息推送 Token、EncodingAESKey）一律隐藏输入：不回显、不进命令行参数
# （ps 看不到）、不写日志。offerId 和道具 ID 不是秘密，正常输入。
#
# 用法：
#   ./set-virtual-payment.sh --check [--env-file 路径]          只体检，不改任何东西
#   ./set-virtual-payment.sh --env 1 [--env-file 路径] [--only xpay|message]
#
# --env 1 = 沙箱（填「沙箱 AppKey」），--env 0 = 现网（填「现网 AppKey」），生产必须是 0。
# --only xpay 只录虚拟支付（offerId、AppKey、道具 ID）；--only message 只录消息推送
# （Token、EncodingAESKey，须与小程序后台「开发管理 → 消息推送」填的一致）。
# 默认的配置文件是生产 server/.env；联调环境传 --env-file …/server/.env.uat。
set -euo pipefail
umask 077

ENV_FILE="/home/ubuntu/education-compass/Phoenix Compass/education compass/server/.env"
CHECK_ONLY=0
XPAY_ENV=""
ONLY="all"
FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)    CHECK_ONLY=1; shift ;;
    --env)      XPAY_ENV="${2-}"; shift 2 ;;
    --env-file) ENV_FILE="${2-}"; shift 2 ;;
    --only)     ONLY="${2-}"; shift 2 ;;
    -h|--help)  sed -n '2,15p' "$0"; exit 0 ;;
    *)          echo "不认识的参数：$1。加 --help 看用法。"; exit 2 ;;
  esac
done

fail() { echo "FAIL  $*"; FAILED=$((FAILED + 1)); }
pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; }

read_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

check_config() {
  echo "体检对象：$ENV_FILE"
  if [[ ! -r "$ENV_FILE" ]]; then fail "读不到配置文件"; return; fi
  local node_env provider app_id app_secret offer env app_key session product token aes switch
  node_env="$(read_env NODE_ENV)"
  provider="$(read_env PAYMENT_PROVIDER)"
  app_id="$(read_env WECHAT_APP_ID)"
  app_secret="$(read_env WECHAT_APP_SECRET)"
  offer="$(read_env WECHAT_XPAY_OFFER_ID)"
  env="$(read_env WECHAT_XPAY_ENV)"
  app_key="$(read_env WECHAT_XPAY_APP_KEY)"
  session="$(read_env SESSION_SECRET)"
  product="$(read_env WECHAT_XPAY_GROWTH_PRODUCT_ID)"
  token="$(read_env WECHAT_MESSAGE_TOKEN)"
  aes="$(read_env WECHAT_MESSAGE_AES_KEY)"
  switch="$(read_env GROWTH_DISCOVERY_PAYMENT_ENABLED)"

  if [[ "$provider" == "wechat" ]]; then pass "PAYMENT_PROVIDER=wechat（虚拟支付）"; else warn "PAYMENT_PROVIDER=${provider:-(空)}；接入虚拟支付时改成 wechat"; fi
  if [[ "$app_id" =~ ^wx[0-9a-fA-F]{16}$ ]]; then pass "WECHAT_APP_ID 格式正确"; else fail "WECHAT_APP_ID 缺失或格式不对"; fi
  if [[ -n "$app_secret" ]]; then pass "WECHAT_APP_SECRET 已配置（换取登录态和接口凭证要用）"; else fail "WECHAT_APP_SECRET 缺失"; fi
  if [[ "$offer" =~ ^[0-9]{6,20}$ ]]; then pass "offerId 格式正确"; else fail "WECHAT_XPAY_OFFER_ID 缺失或不是数字"; fi
  if [[ "$env" == "0" || "$env" == "1" ]]; then
    pass "WECHAT_XPAY_ENV=$env（$([[ "$env" == "0" ]] && echo 现网 || echo 沙箱)）"
    if [[ "$node_env" == "production" && "$env" != "0" ]]; then fail "生产环境必须用现网（WECHAT_XPAY_ENV=0）"; fi
  else
    fail "WECHAT_XPAY_ENV 必须是 0（现网）或 1（沙箱）"
  fi
  if [[ "${#app_key}" -ge 16 ]]; then pass "AppKey 已配置（${#app_key} 个字符）"; else fail "WECHAT_XPAY_APP_KEY 缺失或过短"; fi
  if [[ -n "$app_key" && ( "$app_key" == "$session" || "$app_key" == "$app_secret" ) ]]; then fail "WECHAT_XPAY_APP_KEY 和其他密钥重复了"; fi
  if [[ -z "$product" || "$product" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then pass "道具 ID：${product:-EDUCATION_GROWTH_DISCOVERY_SINGLE_V1（默认）}"; else fail "WECHAT_XPAY_GROWTH_PRODUCT_ID 格式不对"; fi
  if [[ "$token" =~ ^[A-Za-z0-9]{3,32}$ ]]; then pass "消息推送 Token 格式正确"; else fail "WECHAT_MESSAGE_TOKEN 缺失或不是 3-32 位字母数字"; fi
  if [[ "$aes" =~ ^[A-Za-z0-9]{43}$ ]]; then pass "EncodingAESKey 格式正确（43 位）"; else fail "WECHAT_MESSAGE_AES_KEY 缺失或不是 43 位字母数字"; fi
  if [[ "$switch" == "true" ]]; then warn "GROWTH_DISCOVERY_PAYMENT_ENABLED=true：收款已开放"; else pass "GROWTH_DISCOVERY_PAYMENT_ENABLED=${switch:-false}（收款仍关闭）"; fi
}

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  check_config
  echo
  if [[ "$FAILED" -eq 0 ]]; then echo "虚拟支付和消息推送配置齐了。"; exit 0; fi
  echo "$FAILED 项没过。补齐后再跑一次 --check。"
  exit 1
fi

# ---------- 录入 ----------

if [[ ! -w "$ENV_FILE" ]]; then echo "写不了 $ENV_FILE。"; exit 1; fi
if [[ "$ONLY" != "all" && "$ONLY" != "xpay" && "$ONLY" != "message" ]]; then echo "--only 只能是 xpay 或 message。"; exit 2; fi

declare -A VALUES=()

if [[ "$ONLY" != "message" ]]; then
  if [[ "$XPAY_ENV" != "0" && "$XPAY_ENV" != "1" ]]; then echo "缺少 --env 0（现网）或 --env 1（沙箱）。"; exit 2; fi
  if [[ "$(read_env NODE_ENV)" == "production" && "$XPAY_ENV" != "0" ]]; then echo "生产环境只能用 --env 0。没有做任何修改。"; exit 1; fi
  read -rp "offerId（虚拟支付 → 基础配置，纯数字）: " OFFER_ID
  if [[ ! "$OFFER_ID" =~ ^[0-9]{6,20}$ ]]; then echo "offerId 应该是数字。没有做任何修改。"; exit 1; fi
  read -rp "道具 ID（直接回车用 EDUCATION_GROWTH_DISCOVERY_SINGLE_V1）: " PRODUCT_ID
  PRODUCT_ID="${PRODUCT_ID:-EDUCATION_GROWTH_DISCOVERY_SINGLE_V1}"
  if [[ ! "$PRODUCT_ID" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then echo "道具 ID 只能是字母、数字、下划线或短横线。没有做任何修改。"; exit 1; fi
  LABEL="$([[ "$XPAY_ENV" == "0" ]] && echo 现网 || echo 沙箱)"
  read -rsp "${LABEL} AppKey（输入不会显示），然后按 Enter: " APP_KEY
  echo
  read -rsp "再输入一次确认: " APP_KEY_AGAIN
  echo
  if [[ "$APP_KEY" != "$APP_KEY_AGAIN" ]]; then echo "两次输入不一致。没有做任何修改。"; exit 1; fi
  unset APP_KEY_AGAIN
  if [[ "${#APP_KEY}" -lt 16 ]]; then echo "AppKey 太短，确认是从基础配置里复制的${LABEL} AppKey。没有做任何修改。"; exit 1; fi
  VALUES[WECHAT_XPAY_OFFER_ID]="$OFFER_ID"
  VALUES[WECHAT_XPAY_ENV]="$XPAY_ENV"
  VALUES[WECHAT_XPAY_GROWTH_PRODUCT_ID]="$PRODUCT_ID"
  VALUES[WECHAT_XPAY_APP_KEY]="$APP_KEY"
  unset APP_KEY
fi

if [[ "$ONLY" != "xpay" ]]; then
  read -rsp "消息推送 Token（3-32 位字母数字，输入不会显示）: " MSG_TOKEN
  echo
  if [[ ! "$MSG_TOKEN" =~ ^[A-Za-z0-9]{3,32}$ ]]; then echo "Token 应该是 3-32 位字母或数字。没有做任何修改。"; exit 1; fi
  read -rsp "EncodingAESKey（43 位，输入不会显示）: " MSG_AES
  echo
  if [[ ! "$MSG_AES" =~ ^[A-Za-z0-9]{43}$ ]]; then echo "EncodingAESKey 应该正好 43 位字母或数字。没有做任何修改。"; exit 1; fi
  VALUES[WECHAT_MESSAGE_TOKEN]="$MSG_TOKEN"
  VALUES[WECHAT_MESSAGE_AES_KEY]="$MSG_AES"
  unset MSG_TOKEN MSG_AES
fi

BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$BACKUP"

# 通过环境变量传值，秘密不进 argv。
TMP="$(mktemp "$ENV_FILE.XXXXXX")"
KEYS="${!VALUES[*]}"
for key in "${!VALUES[@]}"; do export "V_$key=${VALUES[$key]}"; done
KEYS="$KEYS" awk '
  BEGIN { n = split(ENVIRON["KEYS"], keys, " "); for (i = 1; i <= n; i++) wanted[keys[i]] = 1 }
  {
    split($0, parts, "=")
    if (parts[1] in wanted) { print parts[1] "=" ENVIRON["V_" parts[1]]; seen[parts[1]] = 1; next }
    print
  }
  END { for (key in wanted) if (!(key in seen)) print key "=" ENVIRON["V_" key] }
' "$ENV_FILE" > "$TMP"
for key in "${!VALUES[@]}"; do unset "V_$key"; done
unset VALUES
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"
echo "配置已写入（改动前备份：$BACKUP）。"
echo

FAILED=0
check_config
echo
echo "这一步只写配置，不开放收款；收款由 GROWTH_DISCOVERY_PAYMENT_ENABLED 控制。改完要重启服务才生效。"
[[ "$FAILED" -eq 0 ]] || [[ "$ONLY" != "all" ]]
