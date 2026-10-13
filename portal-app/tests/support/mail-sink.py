#!/usr/bin/env python3
"""Тестовая замена wms-send-mail.py: тот же формат payload, письмо пишется в каталог."""
import json, os, sys, time, uuid

payload = json.load(open(sys.argv[1], encoding="utf-8"))
if os.environ.get("PORTAL_MAIL_SINK_FAIL") == "1":
    print("SMTP недоступен (тест)", file=sys.stderr)
    sys.exit(2)
out = os.environ.get("PORTAL_MAIL_SINK_DIR", "test-results/mail")
os.makedirs(out, exist_ok=True)
name = f"{time.time_ns()}-{uuid.uuid4().hex[:6]}.json"
with open(os.path.join(out, name), "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)
