#!/bin/bash
cd "/home/ubuntu/phoenix/Phoenix Compass/education compass/server" || exit 1
set -a
# shellcheck disable=SC1091
source ./.env.uat
set +a
export LISTEN_HOST=127.0.0.1
exec /home/ubuntu/.nvm/versions/node/v24.20.0/bin/node dist/index.js
