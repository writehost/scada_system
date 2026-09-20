# WMS Скеэт — фронтенд

Next.js 16 (App Router) операционного WMS завода Скеэт. Это снимок живого UI с завода: каталог `app/` лежит в корне, папки `src/` нет.

Прод: [https://wms.scada25.ru](https://wms.scada25.ru).

## Запуск локально

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

Dev-сервер слушает `0.0.0.0:3000`. API без `DATABASE_URL` / бэкенда отвечает 503 — UI при этом открывается.

Секреты (`.env`, `.env.local`, `wms-config.json`, ключи, пароли БД) в этот репозиторий не входят. Не коммить их.

## Что внутри

| Путь | Назначение |
|---|---|
| `app/` | маршруты App Router, в том числе `/api/wms/*` |
| `components/` | UI склада, ГП, дашборд |
| `lib/wms/` | серверная логика склада, партии Векас, размещение |
| `public/` | статика (APK из `public/packages` в выгрузку не входят) |
| `android/` | Capacitor-обёртка ТСД, без `build/` и `.gradle` |

## Скрипты

- `npm run dev` — webpack-dev на порту 3000
- `npm run build` — `next build --webpack`
- `npm run lint` — eslint
