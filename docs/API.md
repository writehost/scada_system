# Полный API SCADA WMS

Интерактивная документация: **https://scada25.ru/help/api**

Сырой OpenAPI 3.0 JSON: **https://scada25.ru/api/wms/openapi**

В спецификации **281 путь / 361 операция**:

| Группа | Где живёт | Примеры |
|---|---|---|
| WMS (Next.js) | `/api/auth`, `/api/app`, `/api/wms/**` | номенклатура, приёмка, задания, ТСД, маркировка |
| Очередь печати GSMT | `/gsmt/api/print-jobs`, `/gsmt/api/code-orders` | sidecar `scada25-print-queue` на `:8790` |
| Сервер обновлений | `/api/v1/**`, `/packages/**` | OTA веба и APK терминалов |

## Авторизация в Swagger

1. `POST /api/auth/login` с `{ "login": "…", "password": "…" }`.
2. Скопировать `accessToken`.
3. Нажать **Authorize** → схема `bearer` → вставить токен.

Для ТСД после обмена кода на `/api/wms/devices/enroll` используйте схему `deviceToken` (`X-Device-Token`).

## Как пересобрать спецификацию

На сервере:

```bash
python3 /opt/scadatable-wms/current/Frontend/../…  # или локально:
python3 tools/scan-api-routes.py /path/to/Frontend/app/api tools/wms-api-inventory.json
python3 tools/generate-full-openapi.py
```

Файл: `docs/openapi/wms.openapi.json` → на сервере `Frontend/openapi/wms.openapi.json`.
