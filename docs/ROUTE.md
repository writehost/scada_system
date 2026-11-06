# SCADA System Route — навигационная панель водителя погрузчика

> Продолжение: **SCADA System Forklift** — режимы REAL/SIMULATION, модуль apriltag-tracking, kara-commands: `docs/FORKLIFT.md`.

Route встроен в существующий контур, а не стоит рядом с ним:

| Компонент | Где в репозитории | Что делает |
|---|---|---|
| **Route (YMS)** | `yms-app/lib/route`, `yms-app/app/api/route/*`, `yms-app/app/route/*` | транспортные задания, машина состояний, карта и маршруты, экраны водителя/диспетчера/редактора |
| **Интеграционный слой WMS** | `lib/wms/route-integration.ts`, `app/api/wms/route/*` | проверка палеты/адреса, идемпотентное перемещение палеты, передача заданий WMS |
| **Сервис позиционирования** | `route-localization/` | Hikrobot + AprilTag → позиция погрузчика |
| **Тесты** | `yms-app/tests/route`, `route-localization/tests` | модульные, приёмочные (16 сценариев ТЗ), браузерные |

Адреса: экран водителя — `https://yms.scadasystem.io/route`, диспетчер — `/route/dispatch`, редактор карты — `/route/editor`.

## Принципы (ТЗ 13.1)

- **WMS — источник истины** по палетам (`codes` + `wms_item_codes.current_location_id`), адресам (`wms_locations`, `FG-<ряд>`), остаткам и номенклатуре. Route не пишет в таблицы WMS: перемещение выполняет WMS через `/api/wms/route/move-pallet`.
- **YMS — источник истины по транспортным заданиям** (`route_tasks`, `route_task_events`).
- **Сервис позиционирования** — источник измерений позиции (`route_positions`).
- **Клиент только отображает и отправляет команды.** Все переходы проверяет сервер; у каждой команды есть `clientRequestId` (идемпотентность) и `expectedVersion` (защита от конкурентных изменений).
- Справочники не дублируются: погрузчики — из флота карщиков WMS (`fg-kara-fleet/site-N.json`, только чтение; Route хранит лишь профиль: тип, габариты, автоназначение), пользователи и роли — `wms_users`/`wms_roles`, ряды склада — план WMS.

## Поток задания

```
WMS (wms_tasks / миссия карщика / диспетчер) ──► Route: CREATED → QUEUED
                                                  │ YMS выбирает погрузчик (offerNext)
                                                  ▼
Водитель:  OFFERED ─принять─► ACCEPTED → EN_ROUTE_PICKUP ─«я на месте»/скан─► AT_PICKUP
           ─скан SSCC (проверка в WMS)─► ─подтвердить погрузку (повторная проверка в WMS)─►
           LOAD_CONFIRMED → EN_ROUTE_DROPOFF ─«я на месте»/скан─► AT_DROPOFF
           ─скан адреса (проверка в WMS)─► ─подтвердить постановку─► WMS move-pallet ─► COMPLETED
           ─► YMS сразу предлагает следующее задание
Сбои:      PAUSED / BLOCKED (с возвратом в прежний статус), CANCELLED; «Проблема» → журнал + действие
```

Переходы — только по таблице `yms-app/lib/route/state-machine.ts`. Нельзя: пропустить скан, подтвердить погрузку без принятого скана своей палеты, завершить завершённое, подтвердить отменённое/переназначенное, переназначить задание с палетой на вилах.

**Подтверждение постановки** (`confirmDropoff`) идёт в три шага: (1) фиксируется `wms_movement_request_id`; (2) вызов WMS без открытой транзакции Route; (3) `COMPLETED` только при `applied`/`duplicate` от WMS. Отказ WMS — задание остаётся у места назначения с причиной; WMS недоступна — `503`, статус `unknown`, повтор безопасен (тот же UUID, `wms_request_log`).

## Карта и маршруты

- Версии карты: `route_map_versions` (`draft` → `published` → `archived`), журнал `route_map_changes` с диффом каждого сохранения, защита ревизией черновика. Водитель всегда видит опубликованную версию.
- **Первая версия построена из реального плана** скриптом `yms-app/scripts/route-draft-map.py`: стеллажи — из 646 рядов плана WMS (`data/route/fg-plan-rows.json`), стены — чёрные линии `warehouse-plan-screen.png`, проёмы — по синим стрелкам движения на плане. Осевые линии проездов получены скелетизацией свободного пространства, к каждому ряду — узел доступа у торца и подъезд к осевой. Итог: 1524 узла, 1639 проездов, 631 из 646 рядов привязаны к адресам `FG-…`, граф связный.
  **Это черновик:** двери, односторонние участки, ширины, пешеходные зоны и точки получения с линий (например `LINE-SIPA`) нужно проверить на складе и задать в редакторе. 15 рядов (ячейки AP2–AP13, AP16, AP17 и AD7) не получили подъезд автоматически — привязать вручную.
- Публикация запрещена, если проезд проходит сквозь стеллаж, стену, препятствие или запретную зону, есть висячие ссылки или повторы (`validateMap`).
- Ребро графа: длина, направление (`oneway`), типы погрузчиков, ширина/высота, движение с грузом, скорость, постоянная блокировка, доплата стоимости. Временные закрытия диспетчера — `route_edge_blocks`.
- Маршрут — A* по рёбрам (`findRoute`), старт от позиции погрузчика с привязкой к ближайшему разрешённому проезду. Расчёт на реальной карте — в среднем 1–2 мс, худший из 200 случайных маршрутов — 7 мс. Закрыли проезд → маршруты активных заданий пересчитываются; пути нет → задание `BLOCKED`, диспетчеру — проблема `no_route`.
- Навигатор — информационный помощник, не система предотвращения столкновений.

## Позиционирование

- Сервис `route-localization` шлёт `POST /api/route/forklifts/{karaId}/position` с токеном устройства (`rdev_…`, привязан к одному погрузчику).
- Сервер отбрасывает измерения из будущего, старые и физически невозможные скачки; `state: lost` не двигает точку.
- Состояния для экрана: `ok` (по меткам), `degraded` (неточная: метка потеряна недавно/прогноз), `lost` («Позиция не определена»), `manual` (задана диспетчером, этап 2 ТЗ, на карте подпись «РУЧН.»).
- Автоприбытие (`AT_PICKUP`/`AT_DROPOFF`) — только по позиции `ok` от AprilTag в радиусе `ROUTE_AUTO_ARRIVE_M` (3 м); ручная позиция и прогноз прибытие не подтверждают. Изменение остатков WMS по позиции невозможно — только по скану адреса.

## API Route (`yms-app/app/api/route`)

Все запросы — с `siteCode` (по умолчанию `skeet`). Авторизация: cookie сессии YMS с `aud: "yms"`, Bearer access token SCADA ID (`aud`/`azp` = `scada-route`), Bearer токен устройства.

| Метод | Путь | Назначение | Право |
|---|---|---|---|
| GET/POST/DELETE | `/api/route/driver/session` | сессия водителя, выбор погрузчика, конец смены | read / drive |
| GET | `/api/route/tasks/active` | экран водителя одним ответом (задание, маршрут, позиция, следующее) | drive |
| GET/POST | `/api/route/tasks` | список / создание задания по палете WMS | read / dispatch |
| GET | `/api/route/tasks/{id}` | задание + журнал | read |
| POST | `/api/route/tasks/{id}/accept` · `decline` · `arrive` · `pause` | команды водителя | drive |
| POST | `/api/route/tasks/{id}/scan-pallet` | проверить SSCC/HU | drive |
| POST | `/api/route/tasks/{id}/confirm-load` | подтвердить погрузку | drive |
| POST | `/api/route/tasks/{id}/scan-address` | проверить адрес | drive |
| POST | `/api/route/tasks/{id}/confirm-dropoff` | подтвердить постановку (через WMS) | drive |
| POST | `/api/route/tasks/{id}/exception` | «Проблема» | drive |
| POST | `/api/route/tasks/{id}/new-address` | другой адрес через WMS | drive / dispatch |
| POST | `/api/route/tasks/{id}/dispatch` | `assign`, `priority`, `pause`, `resume`, `block`, `unblock`, `requeue`, `cancel` | dispatch |
| GET | `/api/route/map/current` | опубликованная карта (ETag) + блокировки | read |
| GET/POST | `/api/route/map/versions` | версии, журнал, новый черновик | read / map.write |
| GET/PUT | `/api/route/map/versions/{id}` | версия + проверка / сохранение черновика | read / map.write |
| POST | `/api/route/map/versions/{id}/publish` | публикация | map.write |
| GET/POST/DELETE | `/api/route/map/blocks` | закрыть/открыть участок | read / dispatch |
| POST | `/api/route/path/calculate` | расчёт маршрута | read |
| GET | `/api/route/forklifts` · PATCH `/forklifts/{id}` | флот + позиции + сессии / профиль, автоназначение | read / dispatch |
| GET/POST | `/api/route/forklifts/{id}/position` | позиция / приём (устройство или ручная) | read / position.write / position.manual |
| GET | `/api/route/events` | SSE: события с дочиткой по `Last-Event-ID` | read |
| GET | `/api/route/board` · `/journal` · `/exceptions` | диспетчерская, журнал, проблемы | read |
| POST | `/api/route/exceptions/{id}/resolve` | решение по проблеме | dispatch |
| GET/POST/PUT | `/api/route/demand` | настройки и синхронизация потребностей WMS | read / dispatch |
| GET/PUT/POST | `/api/route/apriltags` | реестр меток / импорт с плана WMS | read / map.write |
| GET/POST | `/api/route/calibrations` | версии калибровки камер | read / map.write |
| GET | `/api/route/localizer/config` | конфигурация для сервиса позиционирования | устройство |
| GET/POST/DELETE | `/api/route/devices` | токены устройств | map.write |

События (SSE и `route_events`): `task.assigned`, `task.updated`, `task.cancelled`, `forklift.position.updated`, `forklift.localization.lost`, `route.blocked`, `route.unblocked`, `route.recalculated`, `pallet.scan.accepted/rejected`, `address.scan.accepted/rejected`, `wms.movement.confirmed/rejected`, `map.published`, `exception.created/resolved`, `session.started/ended`. Доставка — `pg_notify` после COMMIT (событие отменённой транзакции не уходит). WebSocket не используется: в Next App Router без отдельного сервера проще и надёжнее SSE.

## Интеграционный слой WMS (`app/api/wms/route/*`)

Вызывается Route с сервисным токеном пользователя WMS (`wmsu_…`, право `wms.stock.transfer`).

| Путь | Что делает |
|---|---|
| `POST /api/wms/route/pallet-check` `{code, taskRef}` | палета по SSCC (AI 00, `]C1`, скобки) или HU: площадка, адрес, карантин (`location_status_id = 2`, блок партии), резерв `wms_fg_placement_reservations`, пересорт, номенклатура, партия, кол-во единиц |
| `POST /api/wms/route/address-check` `{locationCode, palletCode, taskRef}` | адрес: активен, карантин, вместимость (`planCapacity`) и занятость, резервы заданий, правила размещения ГП (`checkPlacement`) |
| `POST /api/wms/route/move-pallet` `{requestId(UUID), palletCode, fromLocationCode, toLocationCode, taskRef, wmsRef}` | в одной транзакции и `wms_request_log`: блокировка палеты и адреса, повторная проверка, перенос палеты и всех вложенных кодов, перенос остатка (`applyStockTransfer`, если баланс по адресу ведётся), снятие резерва, закрытие связанного `wms_tasks`, `wms_operation_events: route.pallet.moved`. Повтор `requestId` → сохранённый ответ (`duplicate`). Палета уже не в исходном адресе → `409 pallet_moved` |
| `POST /api/wms/route/recommend-address` | другой адрес по правилам размещения (`recommendPlacement`) |
| `POST /api/wms/route/demand` `{action: pull|release}` | открытые задания WMS по палетам ГП (типы 2,3,4,7,9,10, код палеты в `task_payload.palletCode/sscc/lpn/huCode` или HU строки документа) → помечаются `routeClaim`, статус `claimed`; `release` возвращает в очередь WMS |

> Передача заданий WMS в Route по умолчанию **выключена** (диспетчерская → «Создать» → «Задания WMS»), чтобы Route не перехватил задания у работающих ТСД до согласования процесса.

## Роли

| Роль | Права |
|---|---|
| `route_driver`, `warehouse_operator` | работа водителя |
| `route_senior_driver` | + ручной ввод кода с причиной |
| `route_dispatcher` | диспетчер, ручная позиция, ручной ввод |
| `yms_dispatcher`, `dispatcher` | диспетчер, ручная позиция |
| `route_admin` | редактор карты, метки, устройства, калибровки |
| `admin`, `warehouse_manager` | всё |
| `auditor` | просмотр |

SCADA ID: роли клиента `scada-route` (`driver`, `dispatcher`, `admin`, `viewer`) добавляются к ролям пользователя WMS. Пользователь должен существовать в `wms_users` своей площадки.

## Настройка и развёртывание

Переменные окружения `scadatable-yms`:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | та же `wms_edge` |
| `WMS_AUTH_SECRET` | секрет сессий YMS |
| `WMS_ROUTE_API_URL` | адрес WMS для интеграционного слоя, на заводе `http://127.0.0.1:3004` |
| `WMS_ROUTE_API_TOKEN` | API-токен сервисного пользователя WMS (`wmsu_…`) с правом `wms.stock.transfer` |
| `YMS_FLEET_FILE` / `WMS_SHARED_DIR` | флот карщиков WMS (как в YMS) |
| `ROUTE_OIDC_ISSUER`, `ROUTE_OIDC_AUDIENCE` (`scada-route`), `ROUTE_OIDC_JWKS_URL` | SCADA ID |
| `ROUTE_AUTO_ARRIVE_M` (3), `ROUTE_POS_OK_AGE_S` (2), `ROUTE_POS_DEGRADED_AGE_S` (10) | пороги позиции |

Порядок:

1. **WMS** (`scadatable-wms-ui`): выкатить `lib/wms/route-integration.ts` и `app/api/wms/route/*`. Создать пользователя `route-svc`, роль с правом `wms.stock.transfer`, выпустить API-токен.
2. **YMS** (`/opt/scadatable-yms`): собрать `yms-app` как сейчас (`npm run build`) и скопировать в standalone **ещё и `public/`** (там план склада `public/route/plan/fg.png`): `cp -r public .next/standalone/`. Таблицы `route_*` создаются при первом запросе; для DBA — `Backend/db/patches/2026-11-03_scada_route.sql`.
3. Сессии YMS, выданные до обновления, не содержат `aud` — для Route нужно перезайти (YMS работает как раньше).
4. В `/route/editor` проверить черновик карты, задать точки получения с линий, двери, ограничения; опубликовать.
5. Пилот: 1–2 погрузчика, позиция вручную (этап 2) → установка камер и меток (этап 3). Откат — остановить использование `/route`; WMS и YMS работают без изменений.

## Тесты

```bash
cd yms-app
npm run test:route:unit     # машина состояний, A* на реальной карте, FEFO, коды, решения по скану
npm run test:route          # 22 приёмочных сценария на настоящих обработчиках и PostgreSQL
npm run test:route:ui       # Playwright: экран без прокрутки на 1280×800/1024×600/800×480, полный проход задания
cd ../route-localization && python3 -m pytest -q
```

Стенд (`tests/route/stand.mjs`) поднимает тестовую БД (`tests/route/fixtures/wms-schema.sql` — подмножество таблиц `wms_edge`), обработчики WMS и Route без сборки Next (`tests/route/harness/serve.ts`) и локальный издатель SCADA ID. В песочнице без доступа к npm используются тестовые замены `pg`/`next/server` (`tests/route/shims`); в CI с установленными зависимостями их можно заменить настоящими пакетами.

| № | Сценарий ТЗ | Где проверяется |
|---|---|---|
| 1 | WMS создала потребность → YMS сформировала задание | `acceptance` №1 |
| 2 | Принял задание → маршрут к месту получения | `acceptance` №2, `ui.e2e` |
| 3 | Правильная палета | `acceptance` №3, `ui.e2e` |
| 4 | Неправильная палета отклонена | `acceptance` №4, `ui.e2e` |
| 5 | Погрузка → маршрут к постановке | `acceptance` №5, `ui.e2e` |
| 6 | Прибыл → подтверждение адреса | `acceptance` №6, `ui.e2e` |
| 7 | Неправильный адрес — завершение запрещено | `acceptance` №7, `ui.e2e` |
| 8 | Постановка → WMS обновила адрес, YMS завершила | `acceptance` №8, `ui.e2e` |
| 9 | Предложено следующее задание | `acceptance` №8–9 |
| 10 | Перекрыт участок → пересчёт или отсутствие пути | `acceptance` №10, `unit` |
| 11 | Потеря AprilTag → недостоверность | `acceptance` №11, `route-localization` |
| 12 | Нет сети → нет ложного подтверждения | `acceptance` №12 |
| 13 | Двойное назначение невозможно | `acceptance` №13 |
| 14 | Повтор подтверждения → без дубликата в WMS | `acceptance` №14 |
| 15 | Без прав / чужой токен → отказ | `acceptance` №15 |
| 16 | Планшет: карта и карточка без прокрутки | `ui.e2e` |

**Не проверено в разработке и обязательно на объекте:** работа на реальной `wms_edge` (тестовая схема — подмножество), сборка `next build` (в песочнице не было доступа к npm), MVS SDK и точность позиционирования на складе, реальная топология проездов (черновик карты), нагрузка сети/сервера.

## Инструкция водителя

См. [ROUTE-DRIVER.md](ROUTE-DRIVER.md).
