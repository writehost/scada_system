#!/usr/bin/env bash
# Автообновление UI на shm-form-1 (/var/www/wms). Вызывается из кнопки «Обновить».
set -euo pipefail

WMS_ROOT="${WMS_ROOT:-/var/www/wms}"
FRONTEND="${FRONTEND:-$WMS_ROOT/Frontend}"
APPLY_MJS="$WMS_ROOT/scripts/apply-wms-update.mjs"

if [[ ! -f "$APPLY_MJS" ]]; then
  echo "Missing $APPLY_MJS — copy from repo scripts/" >&2
  exit 1
fi

export WMS_RESTART_UI_SCRIPT="$WMS_ROOT/scripts/restart-wms-ui-10.26.sh"
export WMS_UPDATE_SERVER_INSECURE_TLS="${WMS_UPDATE_SERVER_INSECURE_TLS:-1}"
exec /usr/bin/node "$APPLY_MJS"
