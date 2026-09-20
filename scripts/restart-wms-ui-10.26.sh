#!/usr/bin/env bash
# Перезапуск UI после обновления на 10.26 (pm2)
set -euo pipefail
FRONTEND="${FRONTEND:-/var/www/wms/Frontend}"
WMS_ROOT="${WMS_ROOT:-/var/www/wms}"
cd "$FRONTEND"
mkdir -p scripts

if [[ ! -f scripts/write-wms-build-id.mjs && -f "$WMS_ROOT/scripts/write-wms-build-id.mjs" ]]; then
  cp "$WMS_ROOT/scripts/write-wms-build-id.mjs" scripts/
fi
if [[ -f package.json ]]; then
  sed -i 's|node ../../../scripts/write-wms-build-id.mjs|node scripts/write-wms-build-id.mjs|g' package.json
  sed -i 's|node ../scripts/write-wms-build-id.mjs|node scripts/write-wms-build-id.mjs|g' package.json
fi

if [[ -n "${WMS_APP_BUILD_ID:-}" ]]; then
  echo "buildId from release: $WMS_APP_BUILD_ID"
  export WMS_APP_BUILT_AT="${WMS_APP_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}"
  node -e "
const fs=require('fs');
const p='public/wms-build-id.json';
fs.mkdirSync('public',{recursive:true});
fs.writeFileSync(p, JSON.stringify({buildId:process.env.WMS_APP_BUILD_ID,builtAt:process.env.WMS_APP_BUILT_AT},null,2)+'\n');
"
elif [[ -f scripts/write-wms-build-id.mjs ]]; then
  node scripts/write-wms-build-id.mjs "$FRONTEND"
elif [[ -f "$WMS_ROOT/scripts/write-wms-build-id.mjs" ]]; then
  node "$WMS_ROOT/scripts/write-wms-build-id.mjs" "$FRONTEND"
fi

# npm ci на сервере часто падает после rsync (lock ≠ package.json). Ставим всё, включая dev (tailwind).
unset NODE_ENV
export npm_config_production=false
if [[ -f package-lock.json ]]; then
  npm install --include=dev --no-audit --no-fund || npm install --no-audit --no-fund
else
  npm install --include=dev --no-audit --no-fund
fi

rm -rf .next
npm run build
pm2 restart wms-ui --update-env
echo "OK: $(cat public/wms-build-id.json 2>/dev/null || echo no-build-id)"
