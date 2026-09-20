# SCADA WMS Module (`web/interface`) — локальный запуск

Целевой UI в разработке: **`http://localhost:3000`** (Next.js в этом каталоге).

## Почему на дашборде «HTTP 404» / «WMS данные недоступны»

Страницы вызывают **`/api/wms/*`** (см. `lib/wms-api.ts`). Эти маршруты должны обслуживаться одним из способов ниже.

## Режим по умолчанию в dev (`next.config.mjs`)

Пока **`npm run dev`** в `web/interface`, запросы **`/api/wms/*` проксируются на `http://127.0.0.1:3001`**, если не заданы `WMS_BACKEND_URL` и не поставлен **`WMS_DISABLE_DEV_PROXY=1`**.
Интерфейс должен работать на **3000**; если запустить его на **3001**, прокси попадёт в сам себя и даст `socket hang up / ECONNRESET`.
Дополнительно стоит fail-fast защита в `next.config.mjs`: при self-proxy dev-сервер завершится с понятной ошибкой конфигурации.

Поднимите **`scripts/start-web.ps1`** (он задаёт **`PORT=3001`** для каталога `web/`), затем интерфейс на **:3000**. Так исчезает HTML **404** на `/api/wms/*`, когда junction на Windows не работает.

## Режим A — junction (без `WMS_BACKEND_URL`)

1. Из **корня репозитория** один раз выполнить:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\link-wms-api-junction.ps1
   ```

2. Должен появиться каталог-ссылка `web/interface/app/api/wms` → `web/app/api/wms`.

3. Не задавайте `WMS_BACKEND_URL` (или удалите из `.env.local`).

## Режим B — прокси на основной `web/`

1. Скопируйте `.env.example` в `.env.local`.

2. Установите `WMS_BACKEND_URL` на URL основного приложения Next с API, например:

   ```env
   WMS_BACKEND_URL=http://localhost:3001
   ```

   Порт возьмите из консоли после `npm run dev` в каталоге `web/` (если 3000 занят интерфейсом, Next обычно поднимается на **3001**).

## Порядок сервисов для «живых» данных WMS

Минимальная цепочка для работы обработчиков `web/app/api/wms/*`:

1. **PostgreSQL** доступен; строка в [`web/wms-config.json`](../wms-config.json) или переменные `PG_URL` / `DATABASE_URL` (подхватывает `scripts/use-pg-config.ps1`).
2. Миграции: из корня репозитория `powershell -ExecutionPolicy Bypass -File .\scripts\migrate.ps1`.
3. **codesvc** (gRPC): `powershell -ExecutionPolicy Bypass -File .\scripts\start-codesvc.ps1` → порт **8081**.
4. Основной Next с API: `powershell -ExecutionPolicy Bypass -File .\scripts\start-web.ps1` — запускает **`web/`**, не этот интерфейс. Запомните порт (часто **3001**).
5. **Интерфейс** (этот каталог, порт 3000):

   ```powershell
   cd web/interface
   npm install
   npm run dev
   ```

   Откройте **`http://localhost:3000`**. В режиме B выставьте в `.env.local` тот же порт, что у шага 4.

Удобный вариант для интерфейса с режимом B: скрипт из корня репозитория [`scripts/start-interface.ps1`](../../scripts/start-interface.ps1).

## Важно

- [`scripts/start-web.ps1`](../../scripts/start-web.ps1) поднимает только **`web/`**. Интерфейс `web/interface` всегда запускается отдельно (или через `start-interface.ps1`).
- Промты про отдельный Vite/Ant MVP к этому приложению не относятся; целевой UI — этот Next-проект.

## Если осталась пустая папка `web/scada-system-wms-server`

После удаления прототипа Windows иногда держит каталог (EBUSY). Закройте терминалы/процессы, использующие этот путь, и удалите папку вручную или после перезагрузки — на работу `web/interface` она не влияет.

## Проверка API

**Важно:** **Go `codesvc`** — это только **gRPC :8081** (маркировка/реестр и т.д.). **HTTP `/api/wms/*` не отдаёт Go** — их обслуживает **Next.js** (`web/app/api/wms/*`), либо через junction в interface, либо через прокси на второй Next (`WMS_BACKEND_URL`).

Если в браузере **Next.js 404** на `GET /api/wms/tasks` или `/api/wms/health`, junction не подхватился или нужен режим B (`start-web.ps1` + `WMS_BACKEND_URL`). Диагностика **PostgreSQL** без junction: откройте **`GET http://localhost:3000/api/ping-db`** (физический route только в `interface`).

Из корня репозитория (при запущенном `web/`):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-wms-dev.ps1
```

Ожидается ответ **200** на `GET /api/wms/tasks` у основного Next. Интерфейс на **3000** после настройки junction или `WMS_BACKEND_URL` должен перестать показывать ошибку загрузки дашборда.
