# SCADA System Route — сервис позиционирования погрузчика (AprilTag)

Работает на промышленном ПК погрузчика. Камера Hikrobot смотрит вверх, видит метки AprilTag на потолке,
сервис считает положение погрузчика и отправляет его в SCADA System Route:

**камера → обнаружение AprilTag → поза камеры (PnP) → пересчёт в корпус погрузчика → фильтр → `POST /api/route/forklifts/{karaId}/position`**

## Что делает

| Требование ТЗ (5.2–5.4) | Как реализовано |
|---|---|
| Hikrobot через MVS SDK | `camera.HikrobotCamera` (MvCameraControl_class из установки MVS), Mono8, экспозиция/усиление из конфига. Резерв: OpenCV `VideoCapture`, папка кадров |
| ID метки, положение относительно метки | `detector.AprilTagDetector` (OpenCV aruco: 16h5/25h9/36h10/36h11; pupil-apriltags: + Standard41h12/52h13), `pose.PoseEstimator` — `solvePnP` IPPE_SQUARE / совместный PnP по всем меткам |
| Физические координаты метки, положение камеры на корпусе | реестр меток Route (`/api/route/localizer/config`), калибровка с `cameraToForklift` |
| X, Y, Z, курс, качество | `PoseEstimate` → план склада (x, y в пикселях плана, `metersPerUnit` из карты), Z в метрах, курс в градусах плана |
| Отбрасывать ложные распознавания | неизвестный ID, ошибка перепроецирования > `maxReprojPx`, камера выше метки/невозможная высота, противоречие между метками |
| Фильтрация, сглаживание | `tracker.PoseTracker` — Калман (постоянная скорость), гейт по Махаланобису, переинициализация при устойчивом новом положении |
| Потеря видимости | точка не прыгает; прогноз только при наличии одометрии и не дольше `predictMaxS`; после `lostAfterS` — `state: "lost"` → «Позиция не определена». Автоприбытие по недостоверной позиции сервер не делает |
| Калибровка с версией, привязанная к камере/объективу/разрешению | `route-localization calibrate` → JSON → `POST /api/route/calibrations` (новая версия на каждую загрузку) |
| Тысячи меток | реестр `route_apriltag_markers` (семейство + ID); `tag36h11` даёт 587 ID, для тысяч — `tagStandard41h12` (2115) / `tagStandard52h13` (48714) через pupil-apriltags |

## Источник кадров apriltag-tracking (SCADA System Forklift)

`"source": "apriltag-tracking"` в конфиге — камеру, обнаружение и фильтры даёт модуль `../apriltag-tracking`
(тот, что проверен на MV-CU013-A0GM), а этот сервис переводит его измерения в координаты склада
(`tracking_bridge.py`). Пример — `config.tracking.example.json`; подробности — `docs/FORKLIFT.md`.
Камера может смотреть вперёд (`cameraToForklift.look: "forward"`) на метки на стенах (`mount: "wall"`).

## Установка

```bash
python3 -m venv /opt/scada-route-localizer/venv
/opt/scada-route-localizer/venv/bin/pip install /path/to/route-localization          # numpy + opencv-contrib
/opt/scada-route-localizer/venv/bin/pip install pupil-apriltags                       # если нужны Standard41h12/52h13
# MVS SDK Hikrobot ставится с сайта производителя; путь к MvImport — в camera.mvimportPath
sudo install -D -m 600 config.example.json /etc/scada-route/localizer.json             # заполнить
sudo cp scada-route-localizer.service /etc/systemd/system/ && sudo systemctl enable --now scada-route-localizer
```

1. В редакторе карты Route (`/route/editor` → «Устройства») выпустить токен для погрузчика — вписать в `deviceToken`.
2. Откалибровать камеру (шахматная доска, ≥ 8 снимков, RMS ≤ 0,8 px) и загрузить JSON в Route.
3. Заполнить реестр меток (импорт с плана WMS + **проверить** размер, высоту установки, ориентацию).
4. `route-localization check --config … --image кадр.png` — какие метки видны и какая поза.

## Проверено / не проверено

- **Проверено в разработке:** цепочка детектор → поза → корпус → фильтр → отправка на синтетических кадрах
  с известной позой (ошибка < 3 см, < 1°), отбраковка неизвестных и смещённых меток, потеря и прогноз, отправка в API
  (`pytest`; приём позиции сервером — в приёмочных тестах Route).
- **Не проверено (нужен склад и оборудование):** MVS SDK на реальной камере, точность и устойчивость на складе
  (вибрация, освещение, высота меток, смаз). Распознавание метки ≠ подтверждённая точность — замеры на контрольных точках обязательны.

```bash
python3 -m pytest -q
```
