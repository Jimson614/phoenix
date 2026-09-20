#!/usr/bin/env bash
# One-time setup: store Tencent COS credentials for off-server database backups.
# The SecretKey is read with hidden input and only written to ~/.config/rclone/rclone.conf (mode 600).
set -euo pipefail
umask 077

CONF_DIR=/home/ubuntu/.config/rclone
CONF="$CONF_DIR/rclone.conf"
BUCKET_FILE=/home/ubuntu/.config/phoenix-cos-bucket
SYNC=/home/ubuntu/sync-backups-to-cos.sh

read -rp "存储桶名称（形如 phoenix-backup-1250000000）: " BUCKET
if [[ ! "$BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,50}-[0-9]{5,}$ ]]; then
  echo "格式不对：存储桶名称必须以 -APPID 结尾，例如 phoenix-backup-1250000000。未做任何修改。"
  exit 1
fi
read -rp "所属地域 [ap-guangzhou]: " REGION
REGION="${REGION:-ap-guangzhou}"
if [[ ! "$REGION" =~ ^[a-z]{2}-[a-z]+(-[0-9]+)?$ ]]; then
  echo "格式不对：地域形如 ap-guangzhou。未做任何修改。"
  exit 1
fi
read -rp "SecretId: " SECRET_ID
if [[ ! "$SECRET_ID" =~ ^AKID[A-Za-z0-9]{20,}$ ]]; then
  echo "格式不对：SecretId 通常以 AKID 开头。未做任何修改。"
  exit 1
fi
read -rsp "SecretKey（输入内容不会显示）: " SECRET_KEY
echo
if [[ ! "$SECRET_KEY" =~ ^[A-Za-z0-9]{20,}$ ]]; then
  echo "格式不对：SecretKey 应为 20 位以上字母数字。未做任何修改。"
  exit 1
fi

BACKUP=""
if [ -f "$CONF" ]; then
  BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$CONF" "$BACKUP"
fi
mkdir -p "$CONF_DIR"
SECRET_ID="$SECRET_ID" SECRET_KEY="$SECRET_KEY" REGION="$REGION" \
  bash -c 'cat > '"$CONF"' <<CFG
[cos]
type = s3
provider = TencentCOS
access_key_id = $SECRET_ID
secret_access_key = $SECRET_KEY
endpoint = cos.$REGION.myqcloud.com
acl = private
# The backup key may not create buckets: never probe or create the bucket before upload.
no_check_bucket = true
CFG'
unset SECRET_KEY SECRET_ID
chmod 600 "$CONF"

echo "正在验证：上传一个测试文件再删除……"
PROBE="$(mktemp /tmp/cos-probe-XXXXXX)"
date > "$PROBE"
if ! rclone copyto "$PROBE" "cos:$BUCKET/db/.connectivity-probe" --stats 0 2>/tmp/cos-probe.err; then
  rm -f "$PROBE"
  echo "验证失败："; tail -2 /tmp/cos-probe.err
  rm -f /tmp/cos-probe.err
  printf '%s' "$BUCKET" > "$BUCKET_FILE"; chmod 600 "$BUCKET_FILE"
  echo
  echo "密钥已保存，未加定时任务。请在控制台确认后，直接运行 ~/check-cos-access.sh 重试（不必重新输入密钥）："
  echo "  1) 自定义策略是否已经【关联】到这个子用户（CAM → 用户 → 该用户 → 权限）"
  echo "  2) 策略里的 APPID、完整桶名、地域是否和实际一致"
  echo "  3) 桶是否确实在该地域"
  exit 1
fi
rclone deletefile "cos:$BUCKET/db/.connectivity-probe" --stats 0 2>/dev/null || true
rm -f "$PROBE" /tmp/cos-probe.err
echo "验证通过：可以正常写入和删除。"

printf '%s' "$BUCKET" > "$BUCKET_FILE"
chmod 600 "$BUCKET_FILE"

( crontab -l 2>/dev/null | grep -v "sync-backups-to-cos.sh"; echo "10 4 * * * $SYNC >/dev/null 2>&1" ) | crontab -
echo "已加入定时任务：每天 4:10 上传（本机备份在 3:30 生成）。"

echo "正在做第一次上传……"
"$SYNC"
tail -2 /home/ubuntu/backups/db/cos-sync.log | sed 's/^/  /'
echo "完成。"
