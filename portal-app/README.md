# SCADA SYSTEM — портал scadasystem.io

Официальная точка входа в экосистему: каталог продуктов, заявка на подключение, обработка заявок администратором, приглашение в SCADA ID и раздел «Мои приложения».

Отдельное приложение по образцу `yms-app/`: тот же стек (Next.js 16, React 19, Tailwind 4, `pg`), та же база, только свои таблицы `portal_*`. WMS (`/`), YMS (`yms-app/`) и GSMT не меняются.

| | |
|---|---|
| Каталог | `portal-app/` |
| Порт | `127.0.0.1:3020` |
| Сборка | `npm run build` → `.next/standalone` + `.next/static` + `public/` |
| Таблицы | `portal_access_requests`, `portal_request_events`, `portal_access_grants`, `portal_mail_outbox`, `portal_rate_hits` |

## Аудит перед реализацией

**Что есть в репозитории `writehost/scada_system`**

- Корень — фронтенд и API SCADA WMS (Next.js 16, App Router, `pg`), прод `wms.scada25.ru`. Маршруты `app/(dashboard)/*`, мобильный ТСД `app/mobile/*`, API `app/api/wms/*` (~280 путей, `docs/API.md`).
- `yms-app/` — SCADA YMS отдельным приложением на `yms.scadasystem.io` (MVP, вход по учётке WMS).
- Авторизация WMS: собственная HMAC-сессия (`lib/auth/session.ts`) + вход через SCADA ID по OIDC/PKCE (`lib/wms/scada-id.ts`, `app/api/auth/scada-id/*`). Права приходят из `GET {SCADA_ID_API}/api/v1/permissions/resolve` — `grants[]` по `application_slug`, `organization`, `is_god`.
- SCADA ID — Keycloak-реалм `https://id.scada25.ru/realms/scada-system-id`. Кода самого сервиса SCADA ID в доступных репозиториях нет.
- Интеграции, подтверждённые кодом: WMS↔YMS (заказы и палеты), WMS→QPass (`lib/wms/qpass-api.ts`, `/api/v1/equipment/ensure`), APS внутри WMS (`/production-calendar`), маркировка ЧЗ/СУЗ и очередь печати GSMT, ТСД (Capacitor, офлайн-очередь).
- Почта: помощник `/usr/local/bin/wms-send-mail.py` (JSON-payload), используется уведомлениями WMS.
- Лаунчер `/apps` с утверждёнными цветами WMS/ID/QPass/XRAY/DM — цвета взяты оттуда.

**Чего нет**

- Кода главного сайта scadasystem.io нет ни в этом, ни в соседних репозиториях (`writehost/scada` — прототип Ionic, `writehost/ERM_scada` — утилиты). Портал сделан с нуля внутри монорепозитория, по шаблону `yms-app`.
- Утверждённого логотипа SCADA SYSTEM нет (`logowmsscada.png` — логотип WMS площадки «Скит»). Используется нейтральный знак `components/brand.tsx` — заменяется одним компонентом.
- Кода EMS нет — продукт помечен «В разработке» и не подключается. XRAY и GSMT/Code Route — «По запросу»: код в этом репозитории не подтверждает публичный адрес.
- Публичного API приглашений SCADA ID в коде нет. Портал использует штатный механизм Keycloak (Admin REST: создание пользователя + `execute-actions-email`), см. ниже.

## Как устроено

```
Посетитель ──► /request (3 шага) ──► POST /api/requests ──► portal_access_requests
                                         │  антиспам: токен формы, ловушка, лимиты в БД, idempotency key
                                         └► outbox ► письмо заявителю + администратору
Админ (SCADA ID: is_god / is_super_admin / роль admin в scada-portal)
   /admin/requests ──► Новая → На рассмотрении → Одобрена (часть модулей, организация) / Отклонена
                   └─► «Отправить приглашение» ──► Keycloak Admin REST
                          ├ пользователя нет: создать (email подтверждён, имя из заявки) + execute-actions-email
                          └ есть: письмо «войдите и активируйте»
Заявитель ──► /activate?token=… ──► вход через SCADA ID (email должен совпасть)
                └► группы приложений + организация в SCADA ID ──► «Доступ предоставлен»
Главная ──► «Мои приложения» — только то, что вернул SCADA ID в permissions/resolve
```

- Портал не создаёт своих учётных записей и не хранит паролей. Сессия — подписанный cookie на 8 часов с правами из SCADA ID.
- «Открыть» — обычная ссылка в приложение; права проверяет само приложение.
- Выдача доступа — членство в группе Keycloak, сопоставленной приложению (`PORTAL_SCADA_ID_APP_GROUPS`). Если для приложения группы нет, портал не изображает успех: доступ помечается «Выдать вручную», администратор получает письмо и подтверждает ручную выдачу в карточке заявки.
- Организация — членство в организации Keycloak (`PORTAL_SCADA_ID_ORGANIZATIONS=1`) либо атрибут `scada_organization`.
- Все действия пишутся в `portal_request_events` и видны в журнале заявки.
- Статусы продуктов и адреса — в `lib/products.ts`, переопределяются окружением без правки кода.

## Что нужно настроить в SCADA ID перед запуском

1. Клиент `scada-portal` (confidential, Standard flow, PKCE S256). Redirect URI: `https://scadasystem.io/api/auth/callback`, `https://scadasystem.io/activate*`. Post logout redirect: `https://scadasystem.io/*`.
2. Приложение `scada-portal` в API прав SCADA ID; владельцу экосистемы — роль `admin` (или флаг `is_god`).
3. Сервисный клиент портала (client credentials) с ролями `realm-management`: `view-users`, `manage-users`, `query-groups` (+ `manage-organizations`).
4. Группы приложений, от которых `permissions/resolve` выводит `grants`, и их пути в `PORTAL_SCADA_ID_APP_GROUPS`. **Проверьте на стенде SCADA ID**, что членство в группе действительно даёт grant в `permissions/resolve`: из этого репозитория это не видно. Если права выдаются иначе — оставьте маппинг пустым, портал перейдёт на ручную выдачу.
5. SMTP в реалме Keycloak — письмо «завершите регистрацию» отправляет сам SCADA ID.

## Запуск

```bash
cd portal-app
cp .env.example .env.local      # заполнить
npm install
npm run db:ensure                # таблицы portal_* (иначе создадутся при первом запросе)
npm run dev                      # http://localhost:3020
```

Локально без доступа к SCADA ID: `npm run stub:scada-id` и переменные из `playwright.config.ts` (`TEST_ENV`). Стенд — только для разработки и тестов.

Проверка: `GET /api/health` → `{ database, scadaIdLogin, scadaIdProvisioning }`.

## Тесты

```bash
npm test             # юнит: статусы, валидация, антиспам, редиректы
npm run test:e2e     # Playwright: сборка, реальный Postgres, стенд SCADA ID, перехват писем
```

E2E нужна база `portal_test` (`PORTAL_TEST_DATABASE_URL`), она очищается перед прогоном. Покрыто: главная и каталог, карта экосистемы, мастер заявки с черновиком, обрыв сети и повторная отправка без дубля, серверная валидация, ловушка, токен формы, лимиты, CSRF; админ — назначение, частичное одобрение, организация, приглашение нового и существующего пользователя, ручная выдача, отказ с письмом, запрет недопустимых переходов; активация чужой учётной записью запрещена; «Мои приложения» показывают только одобренное; админка закрыта для анонимов и обычных пользователей; мобильная вёрстка.

## Развёртывание

Как YMS: собрать отдельно, выложить standalone в свой каталог (например `/opt/scadatable-portal`), отдельная служба на `127.0.0.1:3020`, nginx `scadasystem.io` → 3020. Службы WMS/YMS/GSMT не перезапускать.
