#!/usr/bin/env bash
# Re-test COS access with the credentials already stored in ~/.config/rclone/rclone.conf,
# and explain what the failure means. Run after fixing permissions in the console.
set -uo pipefail

CONF=/home/ubuntu/.config/rclone/rclone.conf
BUCKET_FILE=/home/ubuntu/.config/phoenix-cos-bucket
SYNC=/home/ubuntu/sync-backups-to-cos.sh

[ -r "$CONF" ] || { echo "还没有 rclone 配置，请先运行 ~/set-cos-backup.sh"; exit 1; }
BUCKET="$(cat "$BUCKET_FILE" 2>/dev/null || true)"
[ -n "$BUCKET" ] || { echo "还没有记录桶名，请先运行 ~/set-cos-backup.sh"; exit 1; }
echo "桶：$BUCKET"
echo "地域：$(grep -E '^endpoint' "$CONF" | sed -E 's/.*cos\.([a-z0-9-]+)\.myqcloud\.com.*/\1/')"

explain() {
  case "$1" in
    *403*|*AccessDenied*) echo "  → 403 拒绝访问：密钥本身有效，但没有这个桶的权限。最常见原因是自定义策略没有关联到该子用户，其次是策略里的 APPID/桶名/地域写错。" ;;
    *NoSuchBucket*|*404*) echo "  → 桶不存在：桶名写错，或桶不在这个地域。" ;;
    *301*|*PermanentRedirect*|*endpoint*) echo "  → 地域不对：桶在别的地域，请用桶所在地域重新配置。" ;;
    *InvalidAccessKeyId*|*SignatureDoesNotMatch*) echo "  → 密钥不对：SecretId 或 SecretKey 有误，或密钥已被禁用/删除。" ;;
    *) echo "  → 未识别的错误，请把上面这行发给 Claude。" ;;
  esac
}

echo "1/2 读取桶内对象列表（需要 cos:GetBucket 权限）……"
if out="$(rclone lsf "cos:$BUCKET" --max-depth 1 2>&1)"; then
  echo "  通过。当前对象：$(printf '%s' "$out" | wc -l) 个"
else
  echo "  失败：$(printf '%s' "$out" | tail -1)"; explain "$out"; exit 1
fi

echo "2/2 上传并删除一个测试文件（需要 cos:PutObject、cos:DeleteObject 权限）……"
PROBE="$(mktemp /tmp/cos-probe-XXXXXX)"; date > "$PROBE"
if out="$(rclone copyto "$PROBE" "cos:$BUCKET/db/.connectivity-probe" --stats 0 2>&1)"; then
  rclone deletefile "cos:$BUCKET/db/.connectivity-probe" --stats 0 >/dev/null 2>&1 || true
  rm -f "$PROBE"
  echo "  通过。"
else
  echo "  失败：$(printf '%s' "$out" | tail -1)"; explain "$out"
  echo "  正在获取腾讯云返回的详细错误……"
  detail="$(rclone copyto "$PROBE" "cos:$BUCKET/db/.connectivity-probe" --stats 0 --retries 1 --low-level-retries 1 --dump bodies 2>&1     | grep -oE "<Code>[^<]*</Code>|<Message>[^<]*</Message>|<Resource>[^<]*</Resource>" | head -4)"
  rm -f "$PROBE"
  if [ -n "$detail" ]; then printf '  %s
' $detail; else echo "  （未取到详细错误）"; fi
  echo "  说明：Code=AccessDenied 且 Message 提到 kms → 桶用了 KMS 加密，需要额外的 KMS 权限；"
  echo "        Message 提到 policy/authorization → 策略里对象级资源（桶名后带 /*）或 cos:PutObject 没生效。"
  exit 1
fi

echo "权限正常，开始第一次上传……"
"$SYNC" && tail -2 /home/ubuntu/backups/db/cos-sync.log | sed 's/^/  /'
