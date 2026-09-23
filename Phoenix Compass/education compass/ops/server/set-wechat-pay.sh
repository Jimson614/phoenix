#!/usr/bin/env bash
# 录入 / 体检微信支付凭据（普通商户、API v3、“微信支付公钥”模式）。
#
# 秘密值一律隐藏输入：不回显、不进命令行参数（ps 看不到）、不写日志。
# 商户私钥和微信支付公钥安装到 /etc/phoenix/wechatpay，目录 700、文件 600，
# 这样 systemd 单元的 ProtectHome=read-only / ProtectSystem=full 仍然读得到。
#
# 用法：
#   ./set-wechat-pay.sh --check                        只体检，不改任何东西
#   ./set-wechat-pay.sh --base-url https://api.你的域名 \
#       --key ~/apiclient_key.pem --pub ~/pub_key.pem [--cert ~/apiclient_cert.pem]
#
# --cert 只用来核对序列号和私钥是否与证书配套，本身不会被安装。
set -euo pipefail
umask 077

ENV_FILE="/home/ubuntu/education-compass/Phoenix Compass/education compass/server/.env"
KEY_DIR="/etc/phoenix/wechatpay"
KEY_DEST="$KEY_DIR/apiclient_key.pem"
PUB_DEST="$KEY_DIR/wechatpay_pub_key.pem"
SERVICE_USER="ubuntu"

CHECK_ONLY=0
BASE_URL=""
KEY_SRC=""
PUB_SRC=""
CERT_SRC=""
FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)     CHECK_ONLY=1; shift ;;
    --base-url)  BASE_URL="${2-}"; shift 2 ;;
    --key)       KEY_SRC="${2-}"; shift 2 ;;
    --pub)       PUB_SRC="${2-}"; shift 2 ;;
    --cert)      CERT_SRC="${2-}"; shift 2 ;;
    --env-file)  ENV_FILE="${2-}"; shift 2 ;;
    -h|--help)   sed -n '2,13p' "$0"; exit 0 ;;
    *)           echo "不认识的参数：$1。加 --help 看用法。"; exit 2 ;;
  esac
done

fail() { echo "FAIL  $*"; FAILED=$((FAILED + 1)); }
pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; }

read_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# RSA 位数；解析不了就返回 0，调用方据此判失败。
rsa_bits() {
  local file="$1" kind="$2" text=""
  if [[ "$kind" == "public" ]]; then
    text="$(openssl pkey -pubin -in "$file" -noout -text 2>/dev/null || true)"
  else
    text="$(openssl pkey -in "$file" -noout -text 2>/dev/null || true)"
  fi
  local bits
  # OpenSSL 3 对私钥打印的是 "Private-Key: (2048 bit, 2 primes)"，后缀不能写死。
  bits="$(printf '%s' "$text" | sed -n 's/.*-Key: (\([0-9]*\) bit.*/\1/p' | head -n 1)"
  echo "${bits:-0}"
}

check_key_file() {
  local file="$1" kind="$2" label="$3"
  if [[ -z "$file" ]]; then fail "$label 路径未配置"; return; fi
  if [[ ! -r "$file" ]]; then fail "$label 文件读不到：$file"; return; fi
  local perm owner bits
  perm="$(stat -c '%a' "$file")"
  owner="$(stat -c '%U' "$file")"
  if [[ "$perm" == "600" || "$perm" == "400" ]]; then pass "$label 权限 $perm"; else fail "$label 权限是 $perm，必须是 600 或 400"; fi
  if [[ "$owner" == "$SERVICE_USER" ]]; then pass "$label 属主 $owner"; else warn "$label 属主是 $owner，服务以 $SERVICE_USER 运行"; fi
  bits="$(rsa_bits "$file" "$kind")"
  if [[ "$bits" -ge 2048 ]]; then pass "$label 是 $bits 位 RSA"; else fail "$label 不是可解析的 RSA 密钥，或不足 2048 位"; fi
}

check_config() {
  echo "体检对象：$ENV_FILE"
  if [[ ! -r "$ENV_FILE" ]]; then
    fail "读不到配置文件；生产环境还没初始化 server/.env"
    return
  fi

  local provider mch serial v3 pub_id key_path pub_path base notify refund killswitch
  provider="$(read_env PAYMENT_PROVIDER)"
  mch="$(read_env WECHAT_MCH_ID)"
  serial="$(read_env WECHAT_MCH_CERT_SERIAL_NO)"
  v3="$(read_env WECHATPAY_API_V3_KEY)"
  pub_id="$(read_env WECHATPAY_PUBLIC_KEY_ID)"
  key_path="$(read_env WECHAT_MCH_PRIVATE_KEY_PATH)"
  pub_path="$(read_env WECHATPAY_PUBLIC_KEY_PATH)"
  base="$(read_env PUBLIC_BASE_URL)"
  notify="$(read_env WECHAT_PAY_NOTIFY_URL)"
  refund="$(read_env WECHAT_REFUND_NOTIFY_URL)"
  killswitch="$(read_env PAID_COMPASS_ENABLED)"

  if [[ "$provider" == "wechat" ]]; then pass "PAYMENT_PROVIDER=wechat"; else warn "PAYMENT_PROVIDER=${provider:-(空)}；正式收款前必须改成 wechat"; fi
  if [[ "$mch" =~ ^[0-9]{8,12}$ ]]; then pass "商户号格式正确（${#mch} 位数字）"; else fail "WECHAT_MCH_ID 缺失或不是 8-12 位数字"; fi
  if [[ "$serial" =~ ^[0-9A-Fa-f]{40}$ ]]; then pass "证书序列号格式正确（40 位十六进制）"; else fail "WECHAT_MCH_CERT_SERIAL_NO 缺失或不是 40 位十六进制"; fi
  if [[ -n "$v3" ]]; then
    local v3_bytes
    v3_bytes="$(printf '%s' "$v3" | wc -c)"
    if [[ "$v3_bytes" -eq 32 ]]; then pass "APIv3 密钥长度正确（32 字节）"; else fail "WECHATPAY_API_V3_KEY 是 $v3_bytes 字节，必须正好 32 字节"; fi
  else
    fail "WECHATPAY_API_V3_KEY 缺失"
  fi
  if [[ "$pub_id" =~ ^PUB_KEY_ID_[0-9A-Za-z_-]+$ ]]; then pass "微信支付公钥 ID 格式正确"; else fail "WECHATPAY_PUBLIC_KEY_ID 缺失或不是 PUB_KEY_ID_ 开头"; fi

  check_key_file "$key_path" private "商户私钥"
  check_key_file "$pub_path" public "微信支付公钥"

  if [[ -z "$base" ]]; then
    fail "PUBLIC_BASE_URL 未配置；域名就绪后才能填"
  else
    if [[ "$base" =~ ^https://[^/?#]+$ ]]; then pass "PUBLIC_BASE_URL 是无路径的 HTTPS origin"; else fail "PUBLIC_BASE_URL 必须形如 https://api.example.com，不带路径、查询或 fragment"; fi
    if [[ "$notify" == "$base/v1/webhooks/wechat-pay/transactions" ]]; then pass "支付回调地址同源且路径正确"; else fail "WECHAT_PAY_NOTIFY_URL 必须是 $base/v1/webhooks/wechat-pay/transactions"; fi
    if [[ "$refund" == "$base/v1/webhooks/wechat-pay/refunds" ]]; then pass "退款回调地址同源且路径正确"; else fail "WECHAT_REFUND_NOTIFY_URL 必须是 $base/v1/webhooks/wechat-pay/refunds"; fi
  fi

  # kill switch 不是支付凭据的一部分，但看一眼能避免误开收款。
  if [[ "$killswitch" == "true" ]]; then warn "PAID_COMPASS_ENABLED=true：收款已开放"; else pass "PAID_COMPASS_ENABLED=${killswitch:-false}（收款仍关闭）"; fi
}

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  check_config
  echo
  if [[ "$FAILED" -eq 0 ]]; then
    echo "微信支付这一项齐了。其余上线闸门（来源目录、数据库加密连接、发布批准）另算。"
    exit 0
  fi
  echo "$FAILED 项没过。补齐后再跑一次 --check。"
  exit 1
fi

# ---------- 录入 ----------

if [[ ! -w "$ENV_FILE" ]]; then
  echo "写不了 $ENV_FILE。生产环境的 server/.env 还没建立，先做生产环境初始化。"
  exit 1
fi
if [[ -z "$KEY_SRC" ]]; then echo "缺少 --key（证书工具生成的 apiclient_key.pem 在服务器上的路径）。"; exit 2; fi
if [[ -z "$PUB_SRC" ]]; then echo "缺少 --pub（商户平台下载的微信支付公钥 pub_key.pem 在服务器上的路径）。"; exit 2; fi
if [[ ! -r "$KEY_SRC" ]]; then echo "读不到 --key 指定的文件：$KEY_SRC"; exit 1; fi
if [[ ! -r "$PUB_SRC" ]]; then echo "读不到 --pub 指定的文件：$PUB_SRC"; exit 1; fi
if [[ -z "$BASE_URL" ]]; then echo "缺少 --base-url，例如 --base-url https://api.你的域名"; exit 2; fi
BASE_URL="${BASE_URL%/}"
if [[ ! "$BASE_URL" =~ ^https://[^/?#]+$ ]]; then echo "--base-url 必须是不带路径的 HTTPS origin，例如 https://api.example.com"; exit 2; fi

if [[ "$(rsa_bits "$KEY_SRC" private)" -lt 2048 ]]; then
  echo "$KEY_SRC 不是 2048 位以上的 RSA 私钥。确认拿的是证书工具生成的 apiclient_key.pem。"
  exit 1
fi
if [[ "$(rsa_bits "$PUB_SRC" public)" -lt 2048 ]]; then
  echo "$PUB_SRC 不是 2048 位以上的 RSA 公钥。确认下载的是「微信支付公钥」pub_key.pem，不是平台证书。"
  exit 1
fi

read -rp "商户号（8-12 位数字，商户平台首页可见）: " MCH_ID
if [[ ! "$MCH_ID" =~ ^[0-9]{8,12}$ ]]; then echo "商户号应该是 8-12 位数字。没有做任何修改。"; exit 1; fi

read -rp "商户 API 证书序列号（40 位十六进制）: " SERIAL_INPUT
SERIAL="$(printf '%s' "$SERIAL_INPUT" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
if [[ ! "$SERIAL" =~ ^[0-9A-F]{40}$ ]]; then echo "序列号应该是 40 位十六进制。没有做任何修改。"; exit 1; fi

if [[ -n "$CERT_SRC" ]]; then
  if [[ ! -r "$CERT_SRC" ]]; then echo "读不到 --cert 指定的文件：$CERT_SRC"; exit 1; fi
  CERT_SERIAL="$(openssl x509 -in "$CERT_SRC" -noout -serial 2>/dev/null | sed 's/^serial=//' | tr '[:lower:]' '[:upper:]')"
  if [[ -z "$CERT_SERIAL" ]]; then echo "$CERT_SRC 不是可解析的证书。没有做任何修改。"; exit 1; fi
  if [[ "$CERT_SERIAL" != "$SERIAL" ]]; then
    echo "序列号和证书对不上：证书里的是 $CERT_SERIAL。以证书为准重新输入。没有做任何修改。"
    exit 1
  fi
  # 私钥必须配得上这张证书，否则下单会一直验签失败。
  CERT_PUB_DIGEST="$(openssl x509 -in "$CERT_SRC" -noout -pubkey 2>/dev/null | openssl md5)"
  KEY_PUB_DIGEST="$(openssl pkey -in "$KEY_SRC" -pubout 2>/dev/null | openssl md5)"
  if [[ "$CERT_PUB_DIGEST" != "$KEY_PUB_DIGEST" ]]; then
    echo "商户私钥和这张证书不是一对。确认两个文件来自同一次证书申请。没有做任何修改。"
    exit 1
  fi
  echo "序列号与私钥都和证书对得上。"
fi

read -rp "微信支付公钥 ID（PUB_KEY_ID_ 开头）: " PUB_KEY_ID
if [[ ! "$PUB_KEY_ID" =~ ^PUB_KEY_ID_[0-9A-Za-z_-]+$ ]]; then echo "公钥 ID 应该以 PUB_KEY_ID_ 开头。没有做任何修改。"; exit 1; fi

read -rsp "APIv3 密钥（32 个字符，输入不会显示），然后按 Enter: " API_V3_KEY
echo
if [[ "$(printf '%s' "$API_V3_KEY" | wc -c)" -ne 32 ]]; then
  echo "APIv3 密钥必须正好 32 字节，也就是你在商户平台设置的那 32 个字符。没有做任何修改。"
  exit 1
fi
read -rsp "再输入一次确认: " API_V3_KEY_AGAIN
echo
if [[ "$API_V3_KEY" != "$API_V3_KEY_AGAIN" ]]; then echo "两次输入不一致。没有做任何修改。"; exit 1; fi
unset API_V3_KEY_AGAIN

sudo install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$KEY_DIR"
sudo install -m 600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$KEY_SRC" "$KEY_DEST"
sudo install -m 600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$PUB_SRC" "$PUB_DEST"
echo "密钥文件已安装到 $KEY_DIR（目录 700、文件 600）。"

BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$BACKUP"

# 通过环境变量传值，秘密不进 argv。
TMP="$(mktemp "$ENV_FILE.XXXXXX")"
K_MCH="$MCH_ID" K_SERIAL="$SERIAL" K_V3="$API_V3_KEY" K_PUBID="$PUB_KEY_ID" \
K_KEYPATH="$KEY_DEST" K_PUBPATH="$PUB_DEST" K_BASE="$BASE_URL" awk '
  function emit(key, value) { print key "=" value }
  /^WECHAT_MCH_ID=/               { emit("WECHAT_MCH_ID", ENVIRON["K_MCH"]); seen["mch"] = 1; next }
  /^WECHAT_MCH_CERT_SERIAL_NO=/   { emit("WECHAT_MCH_CERT_SERIAL_NO", ENVIRON["K_SERIAL"]); seen["serial"] = 1; next }
  /^WECHAT_MCH_PRIVATE_KEY_PATH=/ { emit("WECHAT_MCH_PRIVATE_KEY_PATH", ENVIRON["K_KEYPATH"]); seen["keypath"] = 1; next }
  /^WECHATPAY_API_V3_KEY=/        { emit("WECHATPAY_API_V3_KEY", ENVIRON["K_V3"]); seen["v3"] = 1; next }
  /^WECHATPAY_PUBLIC_KEY_ID=/     { emit("WECHATPAY_PUBLIC_KEY_ID", ENVIRON["K_PUBID"]); seen["pubid"] = 1; next }
  /^WECHATPAY_PUBLIC_KEY_PATH=/   { emit("WECHATPAY_PUBLIC_KEY_PATH", ENVIRON["K_PUBPATH"]); seen["pubpath"] = 1; next }
  /^PUBLIC_BASE_URL=/             { emit("PUBLIC_BASE_URL", ENVIRON["K_BASE"]); seen["base"] = 1; next }
  /^WECHAT_PAY_NOTIFY_URL=/       { emit("WECHAT_PAY_NOTIFY_URL", ENVIRON["K_BASE"] "/v1/webhooks/wechat-pay/transactions"); seen["notify"] = 1; next }
  /^WECHAT_REFUND_NOTIFY_URL=/    { emit("WECHAT_REFUND_NOTIFY_URL", ENVIRON["K_BASE"] "/v1/webhooks/wechat-pay/refunds"); seen["refund"] = 1; next }
  { print }
  END {
    if (!seen["mch"])     emit("WECHAT_MCH_ID", ENVIRON["K_MCH"])
    if (!seen["serial"])  emit("WECHAT_MCH_CERT_SERIAL_NO", ENVIRON["K_SERIAL"])
    if (!seen["keypath"]) emit("WECHAT_MCH_PRIVATE_KEY_PATH", ENVIRON["K_KEYPATH"])
    if (!seen["v3"])      emit("WECHATPAY_API_V3_KEY", ENVIRON["K_V3"])
    if (!seen["pubid"])   emit("WECHATPAY_PUBLIC_KEY_ID", ENVIRON["K_PUBID"])
    if (!seen["pubpath"]) emit("WECHATPAY_PUBLIC_KEY_PATH", ENVIRON["K_PUBPATH"])
    if (!seen["base"])    emit("PUBLIC_BASE_URL", ENVIRON["K_BASE"])
    if (!seen["notify"])  emit("WECHAT_PAY_NOTIFY_URL", ENVIRON["K_BASE"] "/v1/webhooks/wechat-pay/transactions")
    if (!seen["refund"])  emit("WECHAT_REFUND_NOTIFY_URL", ENVIRON["K_BASE"] "/v1/webhooks/wechat-pay/refunds")
  }
' "$ENV_FILE" > "$TMP"
unset API_V3_KEY
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"
echo "配置已写入（改动前备份：$BACKUP）。"
echo

FAILED=0
check_config
echo
echo "这一步只配好了支付凭据。是否真的开放收款由 PAID_COMPASS_ENABLED 控制，"
echo "它应当保持 false，直到来源目录、生产数据库加密连接和发布批准都到位。"
[[ "$FAILED" -eq 0 ]]
