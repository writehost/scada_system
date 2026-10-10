# SCADA EMS

Учёт и анализ потребления электроэнергии, воды и коммунальных платежей для дома (Home) и предприятий (Industrial). Отдельное приложение экосистемы SCADA System: вход через SCADA ID, та же дизайн-система и стек, что у WMS.

Документация: [`docs/EMS.md`](../docs/EMS.md). Агент шлюза: [`ems-gateway/`](../ems-gateway).

```bash
cp .env.example .env    # заполнить
npm ci
node scripts/migrate.ts
npm run build && npm start      # :3016
node scripts/worker.ts          # фоновые задачи
npm test && npm run test:db && npm run test:e2e
```
