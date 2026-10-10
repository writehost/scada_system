# SCADA EMS Gateway

Локальный агент: опрашивает приборы учёта по Modbus TCP внутри сети предприятия, хранит показания в буфере на диске и отправляет их в облако SCADA EMS только исходящими HTTPS-запросами. Зависимостей нет, нужен Node.js 18+.

- Только чтение (функции 03/04). Функций записи и управления оборудованием нет.
- Буфер: `bufferMaxMb` (по умолчанию 200 МБ), удаление — только после подтверждения облаком; при переполнении теряются самые старые данные, счётчик `droppedItems` виден в облаке.
- Регистрация одноразовым кодом из раздела «Контроллеры», секрет — в `credentials.json` (0600), ротация раз в 30 дней.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin scada-ems
sudo mkdir -p /opt/scada-ems-gateway /etc/scada-ems-gateway /var/lib/scada-ems-gateway
sudo chown scada-ems:scada-ems /var/lib/scada-ems-gateway && sudo chmod 700 /var/lib/scada-ems-gateway
sudo cp -r . /opt/scada-ems-gateway/
echo '{"cloudUrl":"https://ems.example.ru","dataDir":"/var/lib/scada-ems-gateway","bufferMaxMb":200}' | sudo tee /etc/scada-ems-gateway/config.json
sudo -u scada-ems EMS_GATEWAY_CONFIG=/etc/scada-ems-gateway/config.json node /opt/scada-ems-gateway/src/cli.mjs enroll EMS-XXXX-XXXX-XXXX
sudo cp scada-ems-gateway.service /etc/systemd/system/ && sudo systemctl enable --now scada-ems-gateway
```

Проверка прибора вручную: `node src/cli.mjs probe 192.168.1.50 502 1 4 72 float32 ABCD`.
Симулятор для отладки: `npm run simulator` (Modbus TCP на 127.0.0.1:1502). Тесты: `npm test`.
