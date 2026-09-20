#!/bin/bash
cd "/home/ubuntu/phoenix/Phoenix Compass/education compass/server" || exit 1
set -a
# shellcheck disable=SC1091
source ./.env.uat
set +a
exec /home/ubuntu/.nvm/versions/node/v24.20.0/bin/node dist/services/agent-worker-main.js
