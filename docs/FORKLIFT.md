# SCADA System Forklift — водитель погрузчика, задания WMS, позиционирование AprilTag

Продолжение SCADA System Route (`docs/ROUTE.md`): тот же сервер заданий, карта, маршрутизация и шлюз в WMS.
Здесь — что добавлено по ТЗ «SCADA System Forklift» и что выяснил аудит.

Сценарий: **кладовщик назначил → водитель принял → маршрут к палете → камера определяет положение →
скан SSCC, проверка WMS → погрузка → маршрут к адресу → скан адреса → WMS переместила палету → следующее задание.**

## 1. Аудит (фаза A)

| Что проверяли | Результат |
|---|---|
| Реализация `kara-commands` (Postman «Кара ГП») | **В репозитории `writehost/scada_system` нет** ни в `main`, ни в одной из 8 веток (последний коммит `main` — 23.09.2026). Эндпоинт есть только на production. Проверить серверные проверки SSCC, прав, повторов по коду невозможно. |
| Ближайший код — флот кар (`lib/wms/fg-kara-fleet*.ts`, `/karas`, `/missions`, `/path-tags`) | Миссии кар хранятся **JSON-снимком** (`readFgKaraFleet`/`writeFgKaraFleet`) и **не меняют складские остатки**. Плановый симулятор `public/warehouse-plan/fg/forklift-sim.js` сам закрывает миссию `complete`, когда виртуальная кара доезжает до точки. Вывод: `goto/pickup/place`, вероятнее всего, двигают **виртуальную модель** на плане. |
| Авторизация миссий | `PATCH /api/wms/warehouse/finished-goods/missions/[id]` работал **без авторизации** (любой мог завершить/отменить миссию). Исправлено: `requireWmsActor`, как у остальных методов кар; плановый симулятор передаёт Bearer из `localStorage`, если он есть. |
| Очередь заданий WMS, проверка палеты/адреса, перемещение | Используется существующий путь Route → `/api/wms/route/*` (pallet-check, address-check, move-pallet с идемпотентностью по `requestId`, `wms_request_log`). Вторая очередь не создавалась. |
| Модуль компьютерного зрения | `apriltag-tracking/` (Hikrobot MVS, pupil-apriltags, PnP IPPE, сопровождение, калибровка) перенесён в репозиторий **без изменений**; на объекте подтверждены: 6 меток tag16h5 (ID 0–5), калибровка RMS 0,16 px, fx ≈ 2620. |
| `calibration.json` | Формат apriltag-tracking (`camera_matrix`, `dist_coeffs`, `image_width/height`, `rms_px`, `calibrated`). Используется напрямую. Автозагрузка `calibration.json` в apriltag-tracking работает при запуске `main.py`; мост передаёт файл явно (`--calibration`), поэтому `NO_CALIBRATION` из-за забытого параметра невозможен. |

### Политика использования kara-commands

| Команда | Где используется | Почему |
|---|---|---|
| `GET` каталог (`karas`, `tags.rows`, `items`) | `GET /api/route/integrations/kara-commands` — диагностика администратора: доступность WMS, сверка кар и тегов WMS с погрузчиками и метками Route | только чтение |
| `goto` | только кара в режиме **SIMULATION** и только при `ROUTE_KARA_GOTO_IN_SIMULATION=1` (параметр `gotoTagId` симулятора) | двигает виртуальную кару на плане; в REAL позиция берётся только от камеры |
| `pickup`, `place` | **не вызываются** | реализация не проверена; нельзя приравнивать их к подтверждённому физическому перемещению. Складское перемещение — только `/api/wms/route/move-pallet` после скана палеты и адреса |

Токен `wmsu_…` хранится только в переменной окружения сервера `WMS_KARA_API_TOKEN`, в браузер не передаётся.

## 2. Архитектура

```
Hikrobot MV-CU013-A0GM ─ GigE ─► apriltag-tracking (без изменений: MVS, детектор, фильтры, PnP, трек)
                                      │ измерения apriltag-measurement/1 по кадру (углы метки, статус, время кадра)
                                      ▼
                         route-localization/tracking_bridge.py  (Localization Adapter)
                           T_мир←корпус = T_мир←метка · (T_камера←метка)⁻¹ · (T_корпус←камера)⁻¹
                           реестр меток Route · крепление камеры · версия калибровки · трекер потерь/скачков
                                      │ POST /api/route/forklifts/{id}/position   (токен устройства rdev_…)
                                      │ POST /api/route/localizer/status          (камера, метки, калибровка)
                                      ▼
   Task Service · Route Engine · WMS Adapter · Audit (yms-app/lib/route/*)  ──►  WMS /api/wms/route/*
                                      │ SSE /api/route/events
                                      ▼
                  Driver UI /route        Dispatcher UI /route/dispatch        Admin /route/editor
```

| Слой ТЗ | Файлы |
|---|---|
| Driver UI | `yms-app/components/route/driver.tsx`, `map-view.tsx` |
| Dispatcher UI | `yms-app/components/route/dispatch.tsx` |
| WMS Adapter | `yms-app/lib/route/wms-gateway.ts` (+ `app/api/wms/route/*` в WMS), `yms-app/lib/route/kara-commands.ts` |
| Localization Adapter | `route-localization/route_localization/tracking_bridge.py` (+ `geometry.py`, `pose.py`, `tracker.py`) |
| Route Engine | `yms-app/lib/route/graph.ts` (A*, односторонние, закрытые участки, ограничения типа погрузчика) |
| Task Service | `yms-app/lib/route/tasks.ts`, `state-machine.ts`, `arrive.ts` |
| Realtime Transport | `yms-app/lib/route/events.ts` (PostgreSQL LISTEN/NOTIFY → SSE с дочиткой по `Last-Event-ID`) |
| Audit | `route_task_events`, `route_events`, `route_scan_events`, `route_position_log` |

### Статусы ТЗ ↔ машина состояний Route (адаптер соответствия)

| ТЗ | Route |
|---|---|
| Создано / Ожидает назначения / Назначено | `CREATED` / `QUEUED` / `OFFERED` |
| Принято водителем / Движение к грузу | `ACCEPTED` / `EN_ROUTE_PICKUP` |
| Прибыл к грузу / Груз проверен | `AT_PICKUP` / `AT_PICKUP` + принятый скан палеты (`load_scan_id`) |
| Груз погружен / Движение к месту назначения | `LOAD_CONFIRMED` / `EN_ROUTE_DROPOFF` |
| Прибыл к месту назначения / Постановка подтверждена | `AT_DROPOFF` / `AT_DROPOFF` + принятый скан адреса (`address_scan_id`) |
| Выполнено / Приостановлено / Ошибка / Отменено | `COMPLETED` (только после ответа WMS) / `PAUSED` / `BLOCKED` / `CANCELLED` |

## 3. Режимы REAL и SIMULATION

Режим хранится у кары на сервере (`route_forklift_profiles.op_mode`) и виден всегда: метка **REAL** / фиолетовая **СИМУЛЯЦИЯ**
в верхней панели водителя и в списке погрузчиков диспетчера, в симуляции — полоса через всю карту.

| Правило | Где обеспечено |
|---|---|
| Режим меняет только администратор (`route.mode.write`), с причиной, когда у кары нет предложенного/активного задания; событие `forklift.mode.changed` в журнале | `POST /api/route/forklifts/{id}/mode` |
| При смене режима позиция кары сбрасывается — учебная точка не продолжает реальную | `clearPosition` |
| REAL принимает позицию только от камеры (`apriltag`/`odometry`) или ручную; SIMULATION — только от симулятора или ручную | `sourceAllowed`, ответ `mode_mismatch` |
| Учебное задание (`simulation=true`) создаёт только диспетчер, без связи с заданием WMS; назначается только каре в симуляции, реальное — только реальной | `createTask`, `assertModeMatches`, раздельные очереди в `bestCandidate` |
| Учебное задание проходит все этапы (сканы проверяются в WMS **только чтением**), но при постановке WMS не вызывается: `disposition: "simulated"`, событие `simulation.movement.done` | `confirmDropoff` |
| Учебное задание не блокирует реальную работу с той же палетой | раздельные уникальные индексы `route_tasks_one_open_per_hu_real/sim_uidx` |
| Симулятор: кнопка «Ехать по маршруту» двигает кару по построенному маршруту (~3 м/с, 2,5 обновления/с); сервер отклоняет учебные координаты для реальной кары | `driver.tsx`, `POST /api/route/forklifts/{id}/simulate` |

## 4. Позиционирование (фаза D)

- **Системы координат.** Камера (OpenCV), метка (IPPE: x вправо, y вверх, z к наблюдателю), склад (план: x вправо, y вниз, `metersPerUnit`),
  корпус погрузчика (x вперёд, y влево, z вверх). Метка: `mount` = `ceiling` (лицом вниз, `yawDeg` — ось +x) или `wall` (вертикально,
  `yawDeg` — куда смотрит метка); высота центра `zM`; размер `sizeM`; версия привязки `bindingVersion` растёт при каждом изменении геометрии.
- **Камера на корпусе** — `cameraToForklift` в конфиге моста: `look` = `up`/`forward`, смещения x/y/z и поправки углов, **`"measured": true` обязателен**
  (без него мост не запускается — нулевые смещения по умолчанию не принимаются).
- **Калибровка** — тот же `calibration.json`; версия = отпечаток параметров объектива и разрешения (`cal-…`), записывается в каждую позицию
  (`route_positions.calibration_version`). `calibrated:false` не принимается. Отдельно отмечается, есть ли `accuracy_report.csv` с проверкой рулеткой
  (`--accuracy-cm 30,50,100` в apriltag-tracking, ошибка ≤ 2 %); пока проверки нет, у водителя и диспетчера — «точность не проверена».
- **Потеря метки.** Последняя достоверная точка остаётся на карте, показано «N с назад»; затем «Позиционирование недоступно». Прогноз — только с одометрией
  и помечен. Автоприбытие — только по достоверной позиции AprilTag (или учебной в симуляции), прибытие не подтверждает погрузку/постановку.
- **Не публиковать старое как новое.** `measuredAt` — время кадра, сервер отклоняет измерения старше принятого и из будущего.
- **Другие метки.** Только метки из реестра; неизвестные ID и метки без размера (статус `NO_CALIBRATION` в apriltag-tracking) не используются;
  при нескольких метках — общий PnP с проверкой ошибки, противоречивые метки отбрасываются.
- **Семейство.** `tag16h5` (30 ID) — только для стенда, сервис предупреждает в журнале. Для склада — `tag36h11` (587 ID, поддерживают и pupil-apriltags, и OpenCV);
  для тысяч уникальных ID — `tagStandard41h12` (pupil-apriltags). Смена семейства — параметр `families` в конфиге моста, код не меняется.

### Запуск моста на ПК погрузчика

```bash
cd route-localization && pip install -e .            # + требования apriltag-tracking (opencv, pupil-apriltags, MVS SDK)
cp config.tracking.example.json /etc/scada-route/localizer.json
#  заполнить: serverUrl, deviceToken (/route/editor → Устройства), karaId, tracking.ip/calibrationFile,
#  cameraToForklift (ИЗМЕРИТЬ, затем "measured": true)
route-localization run --config /etc/scada-route/localizer.json
```

## 5. Новые и изменённые контракты API (yms-app)

| Метод | Права | Назначение |
|---|---|---|
| `POST /api/route/forklifts/{id}/mode` `{mode, reason}` | `route.mode.write` (route_admin, admin) | REAL ↔ SIMULATION |
| `POST /api/route/forklifts/{id}/simulate` `{x, y, headingDeg, gotoTagId?}` | водитель этой кары / диспетчер; кара в SIMULATION | учебная позиция |
| `POST /api/route/localizer/status` | токен устройства `localizer` | камера, FPS, видимые метки, калибровка |
| `GET /api/route/integrations/kara-commands` | `route.map.write` | диагностика kara-commands (без токена в ответе) |
| `POST /api/route/forklifts/{id}/position` | устройство | + `calibrationVersion`; ответ `mode_mismatch` |
| `POST /api/route/tasks` | `route.dispatch` | + `simulation: true` |
| `PUT /api/route/apriltags` | `route.map.write` | + `mount`, ответ + `bindingVersion` |
| `GET /api/route/forklifts`, `/board`, `/driver/session` | | у погрузчика + `opMode`, `localizer` |
| События SSE | | + `forklift.mode.changed`, `simulation.movement.done`, `localizer.status` |

Переменные окружения: `WMS_KARA_API_URL` (например `https://wms.scada25.ru`), `WMS_KARA_API_TOKEN` (`wmsu_…`), `ROUTE_KARA_GOTO_IN_SIMULATION=1`,
`ROUTE_LOCALIZER_STALE_S` (20). Схема: `Backend/db/patches/2026-11-06_scada_forklift.sql` (с секцией отката); приложение применяет то же при старте.

## 6. Тесты

```bash
cd yms-app
npm run test:route:unit                     # машина состояний, маршруты, коды, kara-commands (подменённый HTTP), источники позиции
npm run test:route                          # приёмка на настоящем PostgreSQL + обработчиках Route и WMS
npm run test:route:ui                       # Chromium: экраны водителя (1280×800, 1024×600, 800×480), диспетчер, редактор, симуляция
cd ../route-localization && python3 -m pytest -q    # мост apriltag-tracking → склад на синтетических кадрах
cd ../apriltag-tracking && python3 -m pytest -q
```

## 7. Что нельзя проверить без оборудования и production

- Поведение `kara-commands` на production (`goto/pickup/place`): нет кода и токена; `pickup/place` не используются до проверки.
- Точность позиционирования на складе: координаты меток ещё не измерены и не внесены в реестр; крепление камеры на погрузчике не измерено;
  проверка расстояний рулеткой (`accuracy_report.csv`) не выполнена. Синтетика подтверждает только согласованность систем координат.
- MVS SDK на ПК погрузчика под нагрузкой, частота 2–5 Гц при движении, вибрация, освещение, смаз.
- Сканеры (USB/Bluetooth — как клавиатура, проверено эмуляцией; камера планшета) на реальных этикетках.
- Работа с реальной WMS `wms.scada25.ru`: все проверки выполнены на тестовой БД со схемой WMS; на production перемещения не выполнялись.
- Сквозной пилотный сценарий (раздел 15 ТЗ) целиком — только после привязки меток и проверки точности на объекте.
