# SCADA WMS Android (com.scadatable.wms)

Исходники нативного Android WMS для совместной разработки.
Выгрузка: 20260824-2340

## Открыть в Android Studio
1. Распаковать архив
2. Open → папка проекта (где `settings.gradle`)
3. Скопировать `keystore.properties.example` → `keystore.properties` и указать свой debug keystore
4. Sync Gradle → Run

## Важно
- В архиве **нет** keystore / `keystore.properties` / `local.properties` (секреты и локальные пути)
- applicationId: `com.scadatable.wms`
- Это **только WMS**, не Capacitor TSD web-обёртка целиком

## На сервере scada25
- Рабочая копия: `/opt/scadatable-wms/android-wms`
- Зеркало в Frontend: `/opt/scadatable-wms/current/Frontend/android`
- Архив: `/opt/wms-update-server/data/packages/scadatable-wms-android-src-20260824-2340.zip`
