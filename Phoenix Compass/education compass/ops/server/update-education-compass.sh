#!/usr/bin/env bash
# Update the Education Compass checkout from the branch the dev PC pushed over SSH
#   (on the PC: git push tencent <branch>  ->  refs/remotes/relay/<branch> here),
# then, only if backend code changed: test, rebuild with Node 24 and restart the UAT API.
set -euo pipefail
export PATH=/home/ubuntu/.nvm/versions/node/v24.20.0/bin:$PATH

REPO=/home/ubuntu/phoenix
PROJECT="Phoenix Compass/education compass"
SERVER="$REPO/$PROJECT/server"

cd "$REPO"
BRANCH="$(git branch --show-current)"
REF="refs/remotes/relay/$BRANCH"
if ! git rev-parse -q --verify "$REF" >/dev/null; then
  echo "没有收到分支 $BRANCH 的推送（$REF 不存在）。先在电脑上执行：git push tencent $BRANCH"
  exit 1
fi

OLD="$(git rev-parse --short HEAD)"
git merge --ff-only -q "$REF"
NEW="$(git rev-parse --short HEAD)"
if [ "$OLD" = "$NEW" ]; then
  echo "代码已是最新：$NEW"
  exit 0
fi
echo "代码已更新：$OLD -> $NEW"
git diff --stat "$OLD" "$NEW" -- "$PROJECT" | tail -1

if git diff --quiet "$OLD" "$NEW" -- "$PROJECT/server"; then
  echo "后端代码没有变化，不需要重建或重启。"
  exit 0
fi

cd "$SERVER"
if ! npm test > /tmp/education-compass-server-test.log 2>&1; then
  echo "后端测试失败，未构建、未重启。日志：/tmp/education-compass-server-test.log"
  exit 1
fi
echo "后端测试通过"

mkdir -p ~/backups
BACKUP=~/backups/education-compass-server-dist-$(date +%Y%m%d-%H%M%S).tar.gz
tar -czf "$BACKUP" dist
if ! npm run -s build; then
  rm -rf dist && tar -xzf "$BACKUP"
  echo "构建失败，已恢复旧的 dist，联调后端未重启。"
  exit 1
fi

pm2 restart phoenix_uat_api > /dev/null
# The agent worker runs from the same dist/ build and must pick up the new code too.
if pm2 describe phoenix_uat_agent_worker > /dev/null 2>&1; then
  pm2 restart phoenix_uat_agent_worker > /dev/null
  echo "AI 处理进程已重启。"
fi
for _ in $(seq 1 20); do
  sleep 1
  curl -sf -m 2 http://127.0.0.1:3010/health > /dev/null && break
done
if curl -sf -m 5 http://127.0.0.1:3010/health > /dev/null; then
  echo "联调后端已重启，健康检查正常。"
else
  echo "联调后端重启后健康检查失败，请查看：pm2 logs phoenix_uat_api"
  exit 1
fi
