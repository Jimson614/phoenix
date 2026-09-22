#!/usr/bin/env bash
# certbot 续期成功后重新加载 nginx，否则续下来的新证书要等到下次手动 reload 才生效。
# 部署位置：/etc/nginx/../letsencrypt/renewal-hooks/deploy/reload-nginx.sh
#   sudo install -m 700 -o root -g root reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
# 该目录下的脚本在任意证书续期成功后由 certbot 自动执行。
set -euo pipefail

# 配置坏掉时不要 reload，宁可继续用旧证书也不能把站点打挂。
# nginx -t 成功时也往 stderr 写字，certbot 会把它报成 "ran with error output"，
# 几个月后看续期日志容易误判成失败；所以成功时静默，失败时再把原始输出打出来。
if ! nginx -t >/dev/null 2>&1; then
  nginx -t
  exit 1
fi
systemctl reload nginx
