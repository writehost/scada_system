/**
 * Сценарии приёмки SCADA System Route (ТЗ, раздел 16) на настоящих обработчиках API
 * Route (yms-app) и интеграционного слоя WMS (основное приложение) и на настоящем PostgreSQL.
 *
 * Запуск: node --test tests/route/acceptance.test.mjs
 * Требуется: локальный PostgreSQL (ROUTE_TEST_PG, по умолчанию postgres://postgres@127.0.0.1:55432), psql, tsx.
 */
import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { createHmac, randomUUID } from "node:crypto"
import {
  SSCC, gs1, psql, api, session, oidcToken, b64u, crid, base, startWms, stopWms, SVC_TOKEN, WMS_PORT, SECRET, ISSUER,
  setupStand, teardownStand,
} from "./stand.mjs"

before(() => setupStand())
after(() => teardownStand())

/* ---------- сценарии ---------- */

const ctx = {}

function stateTask(r) {
  return r.body?.state?.task ?? r.body?.task ?? null
}

describe("SCADA System Route — приёмка", { concurrency: false }, () => {
  test("карта: черновик из реального плана проходит проверку и публикуется", async () => {
    const v = await api("GET", "/api/route/map/versions", { as: "mapadmin" })
    assert.equal(v.status, 200, JSON.stringify(v.body))
    const draft = v.body.versions.find((x) => x.status === "draft")
    assert.ok(draft, "есть черновик v1")
    const full = await api("GET", `/api/route/map/versions/${draft.mapId}`, { as: "mapadmin" })
    const errors = full.body.validation.issues.filter((i) => i.level === "error")
    assert.equal(errors.length, 0, `ошибки карты: ${JSON.stringify(errors.slice(0, 5))}`)
    const g = full.body.map.geometry
    // Точка получения с линии SIPA: ближайший узел проезда в зоне цеха (настраивается в редакторе).
    const near = g.nodes
      .filter((n) => n.kind !== "access")
      .map((n) => ({ n, d: Math.hypot(n.x - 900, n.y - 1200) }))
      .sort((a, b) => a.d - b.d)[0].n
    g.points.push({ id: "pt-sipa", code: "LINE-SIPA", kind: "line_pickup", nodeId: near.id, label: "Линия SIPA" })
    const saved = await api("PUT", `/api/route/map/versions/${draft.mapId}`, {
      as: "mapadmin",
      body: { geometry: g, expectedRevision: full.body.map.revision, summary: "точка получения SIPA" },
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    const stale = await api("PUT", `/api/route/map/versions/${draft.mapId}`, {
      as: "mapadmin",
      body: { geometry: g, expectedRevision: full.body.map.revision },
    })
    assert.equal(stale.status, 409, "устаревшая ревизия черновика отклоняется")
    const pub = await api("POST", `/api/route/map/versions/${draft.mapId}/publish`, { as: "mapadmin", body: { note: "тест" } })
    assert.equal(pub.status, 200, JSON.stringify(pub.body))
    const changes = psql(`SELECT count(*) FROM route_map_changes`)
    assert.ok(Number(changes) >= 3, "журнал изменений карты ведётся")
    const cur = await api("GET", "/api/route/map/current", { as: "driver1" })
    assert.equal(cur.body.map.status, "published")
    ctx.map = cur.body.map.geometry
  })

  test("№1 WMS создала потребность → YMS сформировала реальное задание", async () => {
    let r = await api("PUT", "/api/route/demand", { as: "disp", body: { wmsTasks: true } })
    assert.equal(r.status, 200)
    r = await api("POST", "/api/route/demand", { as: "disp" })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.report.created.length, 1, JSON.stringify(r.body.report))
    const row = psql(`SELECT task_status_id || '|' || (task_payload->>'routeClaim') FROM wms_tasks WHERE task_code='WMS-TR-1'`)
    assert.equal(row, "2|route", "WMS пометила задание как переданное в Route")
    const t = psql(`SELECT task_type || '|' || status || '|' || hu_code || '|' || item_code || '|' || lot_code FROM route_tasks`)
    assert.equal(t, `RELOCATION|QUEUED|${SSCC.P1}|ITEM-1|L-001`)
    const again = await api("POST", "/api/route/demand", { as: "disp" })
    assert.equal(again.body.report.created.length, 0, "повторная синхронизация не дублирует")
  })

  test("задание по несуществующей палете не создаётся", async () => {
    const r = await api("POST", "/api/route/tasks", {
      as: "disp",
      body: { type: "RELOCATION", sourceCode: "FG-A-1", destCode: "FG-A-31", huCode: "00" + gs1("46000000000009999") },
    })
    assert.equal(r.status, 422)
    assert.equal(r.body.code, "pallet_not_found")
  })

  test("№2 водитель принял задание → маршрут к месту получения", async () => {
    // Этап 2 ТЗ: позиция задана оператором вручную и явно помечена как ручная.
    const start = ctx.map.nodes.find((n) => n.id === "acc-A-60") || ctx.map.nodes.find((n) => n.kind === "junction")
    let r = await api("POST", "/api/route/forklifts/kara-1/position", { as: "disp", body: { x: start.x, y: start.y, headingDeg: 90 } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.position.state, "manual")
    r = await api("POST", "/api/route/driver/session", { as: "driver1", body: { karaId: "kara-1", shiftCode: "A" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const offered = r.body.task
    assert.equal(offered.status, "OFFERED", "YMS сразу предложила задание")
    ctx.task1 = offered
    r = await api("POST", `/api/route/tasks/${offered.taskId}/accept`, { as: "driver1", body: { clientRequestId: crid(), expectedVersion: offered.version } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = stateTask(r)
    assert.equal(t.status, "EN_ROUTE_PICKUP")
    assert.equal(t.instruction, "К месту получения — FG-A-1")
    assert.equal(t.route.phase, "to_pickup")
    assert.equal(t.route.result.ok, true, JSON.stringify(t.route.result))
    assert.ok(t.route.result.lengthM > 0)
    ctx.task1 = t
  })

  test("№13 два водителя не могут получить одно задание", async () => {
    let r = await api("POST", "/api/route/driver/session", { as: "driver2", body: { karaId: "kara-2" } })
    assert.equal(r.status, 200)
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/accept`, { as: "driver2", body: { clientRequestId: crid() } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "task_reassigned")
    // второй водитель не может занять погрузчик, на котором уже работают
    r = await api("POST", "/api/route/driver/session", { as: "senior", body: { karaId: "kara-1" } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "kara_busy")
    // гонка: создаём задание и одновременно назначаем его на обе кары
    const c = await api("POST", "/api/route/tasks", { as: "disp", body: { type: "RELOCATION", sourceCode: "FG-A-2", destCode: "FG-A-31", huCode: SSCC.P2, priority: 40 } })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    ctx.task2 = c.body.task
    const assigned = psql(`SELECT status || '|' || COALESCE(kara_id,'') FROM route_tasks WHERE task_id = ${ctx.task2.taskId}`)
    if (assigned.startsWith("QUEUED")) {
      const [a, b] = await Promise.all([
        api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "assign", karaId: "kara-2", expectedVersion: ctx.task2.version } }),
        api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "assign", karaId: "kara-2", expectedVersion: ctx.task2.version } }),
      ])
      const codes = [a.status, b.status].sort()
      assert.deepEqual(codes, [200, 409], `одно назначение проходит, второе — конфликт версии: ${JSON.stringify([a.body, b.body])}`)
    }
    const s2 = await api("GET", "/api/route/tasks/active", { as: "driver2" })
    assert.equal(s2.body.task.taskId, ctx.task2.taskId)
    // одновременное принятие: ровно один успех
    const v = s2.body.task.version
    const [x, y] = await Promise.all([
      api("POST", `/api/route/tasks/${ctx.task2.taskId}/accept`, { as: "driver2", body: { clientRequestId: crid(), expectedVersion: v } }),
      api("POST", `/api/route/tasks/${ctx.task2.taskId}/accept`, { as: "driver2", body: { clientRequestId: crid(), expectedVersion: v } }),
    ])
    assert.deepEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.body, y.body]))
    // возвращаем задание 2 в очередь — понадобится для сценария №9
    const back = await api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "requeue", reason: "для теста следующего задания" } })
    assert.equal(back.status, 200, JSON.stringify(back.body))
    await api("PATCH", "/api/route/forklifts/kara-2", { as: "disp", body: { autoAssign: false } })
    const after = psql(`SELECT status FROM route_tasks WHERE task_id = ${ctx.task2.taskId}`)
    assert.ok(["QUEUED", "OFFERED"].includes(after))
    if (after === "OFFERED") {
      await api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "disp", body: { action: "requeue", reason: "автоназначение kara-2 выключено" } })
    }
  })

  test("№4 неправильная палета — операция отклонена", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-pallet`, { as: "driver1", body: { clientRequestId: crid(), code: SSCC.P6 } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.decision.ok, false)
    assert.equal(r.body.decision.code, "wrong_pallet")
    assert.equal(r.body.decision.expected, SSCC.P1)
    const t = stateTask(r)
    assert.equal(t.status, "AT_PICKUP", "прибытие засчитано по скану, задание не изменено")
    assert.equal(t.huCode, SSCC.P1, "содержимое задания не меняется по факту скана")
    const load = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-load`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(load.status, 409)
    assert.equal(load.body.code, "scan_required")
  })

  test("ручной ввод — только с правом и причиной", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-pallet`, {
      as: "driver1",
      body: { clientRequestId: crid(), code: SSCC.P1, method: "manual", manualReason: "этикетка повреждена" },
    })
    assert.equal(r.status, 403)
    assert.equal(r.body.code, "manual_scan_denied")
  })

  test("№3 правильная палета — проверка прошла, груз можно подтвердить", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-pallet`, { as: "driver1", body: { clientRequestId: crid(), code: `(00)${SSCC.P1.slice(2)}` } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.decision.ok, true, JSON.stringify(r.body.decision))
    assert.equal(r.body.decision.details.itemName, "Сок яблочный 1 л")
    assert.equal(r.body.decision.details.lotCode, "L-001")
    assert.equal(r.body.decision.details.qty, 6)
    assert.ok(stateTask(r).actions.includes("confirm_load"))
  })

  test("№5 подтверждена погрузка → маршрут к месту постановки", async () => {
    const t0 = (await api("GET", "/api/route/tasks/active", { as: "driver1" })).body.task
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-load`, { as: "driver1", body: { clientRequestId: crid(), expectedVersion: t0.version } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = stateTask(r)
    assert.equal(t.status, "EN_ROUTE_DROPOFF")
    assert.equal(t.instruction, "Доставьте палету в FG-A-32")
    assert.equal(t.route.phase, "to_dropoff")
    assert.equal(t.route.result.ok, true, JSON.stringify(t.route.result))
    ctx.task1 = t
  })

  test("№10 перекрыт участок маршрута → пересчёт или отсутствие пути", async () => {
    const edges = ctx.task1.route.result.edgeIds
    const mid = edges[Math.floor(edges.length / 2)]
    let r = await api("POST", "/api/route/map/blocks", { as: "disp", body: { edgeId: mid, reason: "пролив, уборка" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    let s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    if (s.body.task.status === "EN_ROUTE_DROPOFF") {
      assert.equal(s.body.task.route.result.ok, true)
      assert.ok(!s.body.task.route.result.edgeIds.includes(mid), "новый маршрут обходит закрытый проезд")
    }
    // Закрываем все подъезды к адресу назначения → безопасного пути нет.
    const dest = ctx.map.addresses.find((a) => a.locationCode === "FG-A-32").nodeId
    const around = ctx.map.edges.filter((e) => e.from === dest || e.to === dest).map((e) => e.id)
    r = await api("POST", "/api/route/map/blocks", { as: "disp", body: { edgeIds: around, reason: "ремонт ворот" } })
    assert.equal(r.status, 200)
    assert.ok(r.body.rechecked.some((x) => !x.ok), "пересчёт показал отсутствие пути")
    s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    assert.equal(s.body.task.status, "BLOCKED")
    assert.match(s.body.task.blockedReason, /маршрут/)
    const ex = await api("GET", "/api/route/exceptions", { as: "disp" })
    assert.ok(ex.body.exceptions.some((e) => e.kind === "no_route"), "диспетчер уведомлён")
    const events = psql(`SELECT count(*) FROM route_events WHERE topic = 'route.blocked'`)
    assert.ok(Number(events) >= 2)
    for (const b of r.body.blocks) await api("DELETE", `/api/route/map/blocks?blockId=${b.blockId}`, { as: "disp" })
    const exId = ex.body.exceptions.find((e) => e.kind === "no_route").exceptionId
    r = await api("POST", `/api/route/exceptions/${exId}/resolve`, { as: "disp", body: { resolution: "проезд открыт", action: "unblock" } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    assert.equal(s.body.task.status, "EN_ROUTE_DROPOFF")
    assert.equal(s.body.task.route.result.ok, true)
  })

  test("№6 водитель прибыл к назначению → доступно подтверждение адреса", async () => {
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/arrive`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const t = stateTask(r)
    assert.equal(t.status, "AT_DROPOFF")
    assert.equal(t.instruction, "Подтвердите адрес FG-A-32")
  })

  test("№7 неправильный адрес — завершение запрещено", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-address`, { as: "driver1", body: { clientRequestId: crid(), code: "https://wms.scada25.ru/s/c/FG-A-31" } })
    assert.equal(r.status, 200)
    assert.equal(r.body.decision.code, "wrong_address")
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "address_scan_required")
    assert.equal(psql(`SELECT count(*) FROM wms_request_log`), "0", "в WMS ничего не записано")
  })

  test("№12 нет связи с WMS — нет ложного подтверждения", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/scan-address`, { as: "driver1", body: { clientRequestId: crid(), code: "FG-A-32" } })
    assert.equal(r.body.decision.ok, true, JSON.stringify(r.body))
    await stopWms()
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 503, JSON.stringify(r.body))
    assert.equal(r.body.code, "wms_unavailable")
    assert.equal(psql(`SELECT status || '|' || wms_movement_status FROM route_tasks WHERE task_id = ${ctx.task1.taskId}`), "AT_DROPOFF|unknown")
    await startWms()
  })

  test("№8 постановка подтверждена → WMS обновила адрес, YMS завершила задание; №9 предложено следующее", async () => {
    const id = crid()
    ctx.dropCrid = id
    const r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: id } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.wms.disposition, "applied")
    assert.equal(r.body.wms.ledger, "stock_transfer")
    assert.equal(r.body.wms.movedCodes, 9, "палета + 2 короба + 6 единиц")
    assert.equal(psql(`SELECT status FROM route_tasks WHERE task_id = ${ctx.task1.taskId}`), "COMPLETED")
    const at = psql(`SELECT DISTINCT l.location_code FROM wms_item_codes mic JOIN codes c ON c.code_id = mic.code_id
      JOIN wms_locations l ON l.location_id = mic.current_location_id WHERE c.ai21_serial LIKE 'P1-%' OR c.ai21_serial = '${SSCC.P1.slice(2)}'`)
    assert.equal(at, "FG-A-32", "все коды палеты в новом адресе")
    const bal = psql(`SELECT l.location_code || ':' || b.available_qty::int FROM wms_stock_balances b JOIN wms_locations l ON l.location_id = b.location_id ORDER BY 1`)
    assert.equal(bal, "FG-A-1:6\nFG-A-32:6")
    assert.equal(psql(`SELECT task_status_id FROM wms_tasks WHERE task_code = 'WMS-TR-1'`), "4", "задание WMS закрыто")
    // №9: следующее доступное задание предложено без поиска в списке
    assert.equal(r.body.offered, ctx.task2.taskNo, JSON.stringify(r.body.offered))
    assert.equal(r.body.state.task.status, "OFFERED")
    assert.equal(r.body.state.task.taskId, ctx.task2.taskId)
  })

  test("№14 повторное подтверждение — дубликат перемещения в WMS не создаётся", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: ctx.dropCrid } })
    assert.equal(r.status, 200)
    assert.equal(r.body.replayed, true)
    r = await api("POST", `/api/route/tasks/${ctx.task1.taskId}/confirm-dropoff`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(r.status, 409)
    assert.ok(["task_completed", "task_reassigned"].includes(r.body.code), r.body.code)
    assert.equal(psql(`SELECT count(*) FROM wms_request_log WHERE operation_code = 'route_pallet_move'`), "1")
    assert.equal(psql(`SELECT count(*) FROM wms_stock_movements`), "1")
    assert.equal(psql(`SELECT count(*) FROM wms_operation_events WHERE event_type = 'route.pallet.moved'`), "1")
    // повтор того же requestId прямо в WMS — сохранённый ответ, без движения
    const reqId = psql(`SELECT wms_movement_request_id FROM route_tasks WHERE task_id = ${ctx.task1.taskId}`)
    const res = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/move-pallet`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", requestId: reqId, palletCode: SSCC.P1, fromLocationCode: "FG-A-1", toLocationCode: "FG-A-32", taskRef: "x" }),
    })
    const body = await res.json()
    assert.equal(body.disposition, "duplicate")
    assert.equal(psql(`SELECT count(*) FROM wms_stock_movements`), "1")
    // палета уже перемещена — новая операция отклоняется
    const res2 = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/move-pallet`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", requestId: randomUUID(), palletCode: SSCC.P1, fromLocationCode: "FG-A-1", toLocationCode: "FG-A-34", taskRef: "y" }),
    })
    assert.equal(res2.status, 409)
    assert.equal((await res2.json()).code, "pallet_moved")
  })

  test("занятый адрес → новый адрес через WMS; карантин и полный адрес отклоняются", async () => {
    const quarantine = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/pallet-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", code: SSCC.P3 }),
    }).then((r) => r.json())
    assert.ok(quarantine.problems.some((p) => p.code === "pallet_quarantine"))
    const full = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/address-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", locationCode: "FG-A-40" }),
    }).then((r) => r.json())
    assert.equal(full.address.free, 0)
    const other = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/pallet-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ siteCode: "skeet", code: SSCC.P7 }),
    }).then((r) => r.json())
    assert.ok(other.problems.some((p) => p.code === "pallet_other_site"))
  })

  test("отменённое задание: экран обновляется, подтвердить старое нельзя", async () => {
    const s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    const t = s.body.task
    assert.equal(t.status, "OFFERED")
    const acc = await api("POST", `/api/route/tasks/${t.taskId}/accept`, { as: "driver1", body: { clientRequestId: crid(), expectedVersion: t.version } })
    assert.equal(acc.status, 200)
    const c = await api("POST", `/api/route/tasks/${t.taskId}/dispatch`, { as: "disp", body: { action: "cancel", reason: "изменился план отгрузки" } })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    const r = await api("POST", `/api/route/tasks/${t.taskId}/scan-pallet`, { as: "driver1", body: { clientRequestId: crid(), code: SSCC.P2 } })
    assert.equal(r.status, 409)
    assert.equal(r.body.code, "task_cancelled")
    const ev = psql(`SELECT count(*) FROM route_events WHERE topic = 'task.cancelled' AND task_id = ${t.taskId}`)
    assert.equal(ev, "1", "событие task.cancelled для экрана водителя")
  })

  test("№11 потеря AprilTag → недостоверность позиции", async () => {
    const dev = await api("POST", "/api/route/devices", { as: "mapadmin", body: { karaId: "kara-1" } })
    assert.equal(dev.status, 200, JSON.stringify(dev.body))
    const token = dev.body.token
    const n = ctx.map.nodes.find((x) => x.kind === "junction")
    const now = Date.now()
    let r = await api("POST", "/api/route/forklifts/kara-1/position", {
      bearer: token,
      body: { x: n.x, y: n.y, headingDeg: 10, quality: 0.92, tagIds: [12, 13], reprojErrorPx: 0.6, measuredAt: new Date(now).toISOString(), source: "apriltag" },
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.position.state, "ok")
    // скачок через весь склад за 0,2 с — отбрасывается
    r = await api("POST", "/api/route/forklifts/kara-1/position", {
      bearer: token,
      body: { x: n.x + 1500, y: n.y, quality: 0.9, measuredAt: new Date(now + 200).toISOString(), source: "apriltag" },
    })
    assert.equal(r.body.accepted, false)
    assert.equal(r.body.code, "jump")
    // метка потеряна: точка не прыгает, достоверность — «не определена»
    r = await api("POST", "/api/route/forklifts/kara-1/position", {
      bearer: token,
      body: { x: 0, y: 0, quality: 0, measuredAt: new Date(now + 400).toISOString(), source: "apriltag", state: "lost" },
    })
    assert.equal(r.body.accepted, true)
    assert.equal(r.body.position.state, "lost")
    assert.equal(r.body.position.x, n.x, "последняя достоверная точка сохранена")
    assert.equal(psql(`SELECT count(*) FROM route_events WHERE topic = 'forklift.localization.lost'`), "1")
    // устройство не может писать за чужой погрузчик
    r = await api("POST", "/api/route/forklifts/kara-2/position", { bearer: token, body: { x: 1, y: 1, quality: 1, measuredAt: new Date().toISOString() } })
    assert.equal(r.status, 403)
  })

  test("№15 пользователь без прав / чужой токен — сервер отклоняет", async () => {
    let r = await api("POST", `/api/route/tasks/${ctx.task2.taskId}/dispatch`, { as: "viewer", body: { action: "cancel", reason: "x x x" } })
    assert.equal(r.status, 403)
    r = await api("POST", "/api/route/driver/session", { as: "viewer", body: { karaId: "kara-2" } })
    assert.equal(r.status, 403)
    r = await api("GET", "/api/route/tasks/active", { as: "outsider" })
    assert.equal(r.status, 403)
    assert.equal(r.body.code, "site_denied")
    // сессия без audience "yms" (например, выданная WMS с тем же секретом) — не принимается
    const id = psql(`SELECT user_id FROM wms_users WHERE login = 'driver1'`)
    const now = Date.now()
    const data = Buffer.from(JSON.stringify({ userId: id, login: "driver1", fio: "x", position: "x", iat: now, exp: now + 60000 })).toString("base64url")
    const sig = createHmac("sha256", SECRET).update(data).digest("base64url")
    const res = await fetch(`${base}/api/route/tasks/active?siteCode=skeet`, { headers: { cookie: `yms_session=${data}.${sig}` } })
    assert.equal(res.status, 401)
    assert.equal((await res.json()).code, "session_audience")
    // SCADA ID: токен другого приложения отклоняется, токен Route — принимается
    r = await api("GET", "/api/route/driver/session", { bearer: oidcToken({ aud: "scada-wms", azp: "scada-wms", preferred_username: "oidcdriver@skeet.ru" }) })
    assert.equal(r.status, 401)
    assert.equal(r.body.code, "token_audience")
    r = await api("GET", "/api/route/driver/session", { bearer: oidcToken({ aud: "scada-route", preferred_username: "oidcdriver@skeet.ru" }) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.user.login, "oidcdriver@skeet.ru")
    r = await api("GET", "/api/route/driver/session", { bearer: oidcToken({ aud: "scada-route", preferred_username: "oidcdriver@skeet.ru", exp: Math.floor(Date.now() / 1000) - 600 }) })
    assert.equal(r.status, 401)
    // поддельная подпись
    const good = oidcToken({ aud: "scada-route", preferred_username: "oidcdriver@skeet.ru" }).split(".")
    const forged = `${good[0]}.${b64u({ iss: ISSUER, sub: "u-1", aud: "scada-route", exp: 9999999999, preferred_username: "disp" })}.${good[2]}`
    r = await api("GET", "/api/route/driver/session", { bearer: forged })
    assert.equal(r.status, 401)
    // WMS: без сервисного токена интеграционный слой закрыт
    const w = await fetch(`http://127.0.0.1:${WMS_PORT}/api/wms/route/move-pallet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteCode: "skeet", requestId: randomUUID(), palletCode: SSCC.P2, toLocationCode: "FG-A-34", taskRef: "z" }),
    })
    assert.equal(w.status, 401)
  })

  test("водитель сменил погрузчик — прежняя сессия закрыта, задания перепроверены", async () => {
    const c = await api("POST", "/api/route/tasks", { as: "disp", body: { type: "PRODUCTION_PICKUP", sourceCode: "LINE-SIPA", destCode: "FG-B-5", huCode: SSCC.P5, priority: 80 } })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    let s = await api("GET", "/api/route/tasks/active", { as: "driver1" })
    assert.equal(s.body.task?.taskId, c.body.task.taskId, JSON.stringify(s.body.task))
    const acc = await api("POST", `/api/route/tasks/${c.body.task.taskId}/accept`, { as: "driver1", body: { clientRequestId: crid() } })
    assert.equal(acc.status, 200)
    assert.equal(stateTask(acc).instruction, "К месту получения — LINE-SIPA")
    await api("DELETE", "/api/route/driver/session", { as: "driver2", body: { reason: "конец смены" } })
    s = await api("POST", "/api/route/driver/session", { as: "driver1", body: { karaId: "kara-2" } })
    assert.equal(s.status, 200, JSON.stringify(s.body))
    assert.equal(s.body.session.karaId, "kara-2")
    assert.equal(psql(`SELECT status || '|' || COALESCE(kara_id, '-') FROM route_tasks WHERE task_id = ${c.body.task.taskId}`), "QUEUED|-")
    assert.equal(psql(`SELECT count(*) FROM route_driver_sessions WHERE login = 'driver1' AND ended_at IS NULL`), "1")
  })

  test("журнал: каждый переход записан с ID задания, временем, пользователем и состоянием WMS", async () => {
    const j = await api("GET", `/api/route/journal?taskId=${ctx.task1.taskId}`, { as: "disp" })
    assert.equal(j.status, 200)
    const actions = j.body.events.map((e) => e.action).reverse()
    for (const a of ["create", "queue", "offer", "accept", "start_pickup", "scan_pallet_rejected", "scan_pallet", "confirm_load", "start_dropoff", "block", "unblock", "arrive_dropoff", "scan_address_rejected", "scan_address", "wms_unavailable", "complete"]) {
      assert.ok(actions.includes(a), `в журнале есть ${a}: ${actions.join(",")}`)
    }
    const complete = j.body.events.find((e) => e.action === "complete")
    assert.equal(complete.actor, "driver1")
    assert.equal(complete.wmsState.disposition, "applied")
  })

  test("SSE: поток событий с дочиткой по Last-Event-ID", async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/route/events?siteCode=skeet&since=0`, { headers: { cookie: session("disp") }, signal: ctrl.signal })
    assert.equal(res.status, 200)
    assert.match(res.headers.get("content-type"), /text\/event-stream/)
    const reader = res.body.getReader()
    let text = ""
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !text.includes("event: task.assigned")) {
      const { value, done } = await reader.read()
      if (done) break
      text += Buffer.from(value).toString()
    }
    ctrl.abort()
    assert.match(text, /event: task\.assigned/)
    assert.match(text, /id: \d+/)
  })
})
