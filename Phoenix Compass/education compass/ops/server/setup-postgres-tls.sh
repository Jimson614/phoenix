#!/usr/bin/env bash
# 给本机 PostgreSQL 配一套私有 CA 签发的服务端证书，让 Education Compass 的库
# 能用 sslmode=verify-full 连接（server/src/config.ts 在 production 下强制要求）。
#
# 为什么不是全局开关：这台实例同时跑 compass、phoenix_uat 和 phoenix_core，
# pg_hba.conf 是四个项目共用的。把 `host all all` 改成 hostssl 会一次性打断
# 另外三个项目。所以这里只针对指定的库加规则，并且插在通用规则之前。
#
# 用法：
#   ./setup-postgres-tls.sh                 只生成证书并配置 PostgreSQL（不改 pg_hba）
#   ./setup-postgres-tls.sh --enforce compass [phoenix_uat ...]
#                                           额外对这些库强制 TLS（拒绝明文连接）
#   ./setup-postgres-tls.sh --check         只体检，不改任何东西
set -euo pipefail
umask 077

PG_VERSION=16
PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
SSL_DIR="/etc/postgresql/$PG_VERSION/main/ssl"
CA_KEY="$SSL_DIR/phoenix-db-ca.key"
CA_CRT="$SSL_DIR/phoenix-db-ca.crt"
SRV_KEY="$SSL_DIR/server.key"
SRV_CRT="$SSL_DIR/server.crt"
# 客户端要读 CA，所以放一份到应用用户读得到的位置。
CLIENT_CA="/etc/phoenix/pgtls/ca.crt"
MARKER="# --- phoenix education compass TLS enforcement (managed by setup-postgres-tls.sh) ---"
MARKER_END="# --- end phoenix education compass TLS enforcement ---"

MODE="setup"
ENFORCE_DBS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)   MODE="check"; shift ;;
    --enforce) MODE="enforce"; shift; while [[ $# -gt 0 && "$1" != --* ]]; do ENFORCE_DBS+=("$1"); shift; done ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$1"; exit 2 ;;
  esac
done

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILED=$((FAILED + 1)); }
FAILED=0

check_state() {
  echo "=== 证书 ==="
  if sudo test -r "$SRV_CRT"; then
    local subject issuer enddate
    subject="$(sudo openssl x509 -in "$SRV_CRT" -noout -subject 2>/dev/null | sed 's/^subject=//')"
    issuer="$(sudo openssl x509 -in "$SRV_CRT" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
    enddate="$(sudo openssl x509 -in "$SRV_CRT" -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
    pass "服务端证书 subject=$subject"
    pass "签发者 $issuer"
    pass "有效期至 $enddate"
    echo -n "      SAN: "; sudo openssl x509 -in "$SRV_CRT" -noout -ext subjectAltName 2>/dev/null | tail -n1 | sed 's/^ *//'
    if sudo openssl verify -CAfile "$CA_CRT" "$SRV_CRT" >/dev/null 2>&1; then
      pass "证书链可被私有 CA 验证"
    else
      fail "证书链验证不过"
    fi
  else
    fail "还没有服务端证书（$SRV_CRT）"
  fi

  echo
  echo "=== PostgreSQL 配置 ==="
  local ssl_on cert_path
  ssl_on="$(sudo -u postgres psql -tAc 'show ssl' 2>/dev/null || echo '?')"
  [[ "$ssl_on" == "on" ]] && pass "ssl = on" || fail "ssl = $ssl_on"
  cert_path="$(sudo -u postgres psql -tAc 'show ssl_cert_file' 2>/dev/null || echo '?')"
  [[ "$cert_path" == "$SRV_CRT" ]] && pass "ssl_cert_file 指向私有证书" || fail "ssl_cert_file = $cert_path（仍不是私有证书）"

  echo
  echo "=== 客户端 CA ==="
  if [[ -r "$CLIENT_CA" ]]; then
    pass "应用可读的 CA 副本：$CLIENT_CA（权限 $(stat -c '%a' "$CLIENT_CA")）"
  else
    fail "应用读不到 CA 副本（$CLIENT_CA）"
  fi

  echo
  echo "=== 强制 TLS 的库 ==="
  if sudo grep -q "^$MARKER$" "$PG_HBA" 2>/dev/null; then
    sudo sed -n "/^$MARKER$/,/^$MARKER_END$/p" "$PG_HBA" | grep -E "^hostssl|^hostnossl" | sed 's/^/      /'
  else
    echo "      （还没有对任何库强制 TLS）"
  fi
}

if [[ "$MODE" == "check" ]]; then
  check_state
  echo
  [[ "$FAILED" -eq 0 ]] && echo "配置齐了。" || { echo "$FAILED 项没过。"; exit 1; }
  exit 0
fi

# ---------- 生成证书 ----------

if [[ "$MODE" == "setup" ]]; then
  sudo install -d -m 700 -o postgres -g postgres "$SSL_DIR"

  if sudo test -f "$CA_CRT"; then
    echo "CA 已存在，跳过生成（要换 CA 请先手动移走 $SSL_DIR）。"
  else
    echo "生成私有 CA（10 年）..."
    sudo openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$CA_KEY" >/dev/null 2>&1
    sudo openssl req -x509 -new -key "$CA_KEY" -sha256 -days 3650 -out "$CA_CRT" \
      -subj "/O=Phoenix Nova/CN=Phoenix Internal DB CA" >/dev/null 2>&1
  fi

  if sudo test -f "$SRV_CRT"; then
    echo "服务端证书已存在，跳过生成。"
  else
    echo "签发服务端证书（10 年）..."
    # SAN 必须同时覆盖 localhost 和 127.0.0.1：verify-full 校验的是连接串里写的那个
    # 主机名，生产用 localhost、联调用 127.0.0.1，两种写法都要能过。
    sudo openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$SRV_KEY" >/dev/null 2>&1
    sudo bash -c "openssl req -new -key '$SRV_KEY' -subj '/O=Phoenix Nova/CN=localhost' \
      -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1' \
      -out '$SSL_DIR/server.csr'" >/dev/null 2>&1
    sudo bash -c "openssl x509 -req -in '$SSL_DIR/server.csr' -CA '$CA_CRT' -CAkey '$CA_KEY' \
      -CAcreateserial -days 3650 -sha256 \
      -extfile <(printf 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n') \
      -out '$SRV_CRT'" >/dev/null 2>&1
    sudo rm -f "$SSL_DIR/server.csr"
  fi

  # 目录是 700 postgres，脚本以 ubuntu 运行，通配符在这里展不开；用 -R 让 sudo 自己遍历。
  sudo chown -R postgres:postgres "$SSL_DIR"
  sudo chmod 600 "$CA_KEY" "$SRV_KEY"
  sudo chmod 644 "$CA_CRT" "$SRV_CRT"

  # 应用以 ubuntu 身份运行，要读得到 CA 才能做 verify-full。
  sudo install -d -m 755 -o root -g root /etc/phoenix/pgtls
  sudo install -m 644 -o root -g root "$CA_CRT" "$CLIENT_CA"

  echo "指向新证书..."
  sudo cp -p "$PG_CONF" "$PG_CONF.bak-$(date +%Y%m%d-%H%M%S)"
  sudo sed -i \
    -e "s#^ssl_cert_file = .*#ssl_cert_file = '$SRV_CRT'#" \
    -e "s#^ssl_key_file = .*#ssl_key_file = '$SRV_KEY'#" \
    -e "s#^ssl = .*#ssl = on#" \
    "$PG_CONF"
  sudo systemctl reload postgresql
  sleep 2
  echo "完成。"
  echo
  check_state
  exit 0
fi

# ---------- 对指定库强制 TLS ----------

if [[ "${#ENFORCE_DBS[@]}" -eq 0 ]]; then
  echo "--enforce 后面要跟至少一个库名。"
  exit 2
fi

sudo test -r "$SRV_CRT" || { echo "还没生成证书，先不带参数跑一次。"; exit 1; }

sudo cp -p "$PG_HBA" "$PG_HBA.bak-$(date +%Y%m%d-%H%M%S)"

# 先移除旧的托管段落，保证可重复执行。
sudo sed -i "/^$MARKER$/,/^$MARKER_END$/d" "$PG_HBA"

BLOCK="$MARKER"$'\n'
for db in "${ENFORCE_DBS[@]}"; do
  # hostnossl 的拒绝规则必须排在 hostssl 之前，也必须排在通用 host 规则之前，
  # 否则明文连接会被后面的 `host all all` 放行，强制就形同虚设。
  BLOCK+="hostnossl $db all 127.0.0.1/32 reject"$'\n'
  BLOCK+="hostnossl $db all ::1/128      reject"$'\n'
  BLOCK+="hostssl   $db all 127.0.0.1/32 scram-sha-256"$'\n'
  BLOCK+="hostssl   $db all ::1/128      scram-sha-256"$'\n'
done
BLOCK+="$MARKER_END"

# pg_hba.conf 是 640 postgres:postgres，脚本以 ubuntu 运行读不了它，
# 所以先 sudo cat 取出内容、在 shell 里拼好，再整份写回去。
# 规则必须插在第一条现有规则之前：pg_hba 自上而下匹配，排在通用的
# `host all all 127.0.0.1/32` 之后就永远轮不到。
EXISTING="$(sudo cat "$PG_HBA")"
NEW="$(BLOCK_TEXT="$BLOCK" awk '
  !inserted && /^[[:space:]]*(local|host|hostssl|hostnossl)[[:space:]]/ {
    print ENVIRON["BLOCK_TEXT"]; inserted = 1
  }
  { print }
  END { if (!inserted) print ENVIRON["BLOCK_TEXT"] }
' <<< "$EXISTING")"
printf '%s\n' "$NEW" | sudo tee "$PG_HBA" >/dev/null
sudo chown postgres:postgres "$PG_HBA"
sudo chmod 640 "$PG_HBA"

sudo systemctl reload postgresql
sleep 2
echo "已对以下库强制 TLS：${ENFORCE_DBS[*]}"
echo
check_state
