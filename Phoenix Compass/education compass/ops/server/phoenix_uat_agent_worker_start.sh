#!/bin/bash
# pm2 进程 phoenix_uat_agent_worker 的启动脚本。
# 同样用 --env-file 而不是 source，理由见 phoenix_uat_start.sh 的注释。
cd "/home/ubuntu/phoenix/Phoenix Compass/education compass/server" || exit 1
exec /home/ubuntu/.nvm/versions/node/v24.20.0/bin/node --env-file=./.env.uat dist/services/agent-worker-main.js
