import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  calculateProductionGanttLayout,
  filterProductionPlanLinks,
  formatApsItemCompositeLine,
  ganttTaskIdFromPlanId,
  inclusiveEndFromExclusive,
  linkIdFromGanttLinkId,
  planIdFromGanttTaskId,
  productionPlanLinksToGanttLinks,
  productionPlansToGanttTasks,
  resolveApsPlanQtyLabel,
  toDateKey,
} from "../lib/wms/production-gantt-mapper.ts"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function plan(patch = {}) {
  return {
    planId: "42",
    code: "PLN-20260603-001",
    planDate: "2026-06-03",
    planDateTo: "2026-06-06",
    workshopCode: "2",
    lineCode: "SIPA",
    itemCode: "ITEM-1",
    itemName: "Тестовый продукт",
    plannedQty: 100,
    status: "checked",
    materialWarehouseCode: "OS",
    externalSource: "manual",
    externalId: null,
    note: null,
    shortageCount: 0,
    isFullyCovered: true,
    reservedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    materials: [
      {
        planMaterialId: "1",
        itemCode: "MAT-1",
        itemName: "Материал",
        qtyPer: 1,
        scrapPct: 0,
        requiredQty: 100,
        availableQty: 100,
        reservedQty: 0,
        shortageQty: 0,
        uomCode: "шт",
        sortOrder: 1,
      },
    ],
    ...patch,
  }
}

test("APS maps inclusive WMS dates to exclusive SVAR dates", () => {
  const tasks = productionPlansToGanttTasks([plan()])
  assert.equal(tasks.length, 2)
  const task = tasks[1]
  assert.equal(toDateKey(task.start), "2026-06-03")
  assert.equal(toDateKey(task.end), "2026-06-07")
  assert.equal(inclusiveEndFromExclusive(task.end), "2026-06-06")
  assert.equal(task.progress, 100)
  assert.equal(task.qtyLabel, "100 шт")
  assert.equal(task.plannedQty, 100)
  assert.equal(resolveApsPlanQtyLabel(plan(), task), "100 шт")
})

test("APS rejects invalid calendar dates and clamps legacy reversed ranges", () => {
  assert.equal(productionPlansToGanttTasks([plan({ planDate: "2026-02-31" })]).length, 1)
  const tasks = productionPlansToGanttTasks([
    plan({ planDate: "2026-06-10", planDateTo: "2026-06-01" }),
  ])
  assert.equal(toDateKey(tasks[1].start), "2026-06-10")
  assert.equal(toDateKey(tasks[1].end), "2026-06-11")
})

test("APS keeps stable task and link identifiers", () => {
  assert.equal(ganttTaskIdFromPlanId("42"), "plan:42")
  assert.equal(planIdFromGanttTaskId("plan:42"), "42")
  assert.equal(planIdFromGanttTaskId("line:SIPA"), null)
  assert.equal(linkIdFromGanttLinkId("link:7"), "7")

  assert.deepEqual(
    productionPlanLinksToGanttLinks([
      { linkId: "7", sourcePlanId: "42", targetPlanId: "43", type: "e2s", lagDays: 2 },
    ]),
    [{ id: "link:7", source: "plan:42", target: "plan:43", type: "e2s", lag: 2 }]
  )
})

test("APS keeps only links whose tasks are visible after filtering", () => {
  const links = [
    { linkId: "1", sourcePlanId: "42", targetPlanId: "43", type: "e2s", lagDays: 0 },
    { linkId: "2", sourcePlanId: "43", targetPlanId: "44", type: "e2s", lagDays: 0 },
  ]
  assert.deepEqual(
    filterProductionPlanLinks(links, new Set(["42", "43"])).map((link) => link.linkId),
    ["1"]
  )
})

test("APS layout fits a month on a wide screen and remains usable on a narrow screen", () => {
  assert.deepEqual(calculateProductionGanttLayout(1524, 30), {
    gridWidth: 560,
    cellWidth: 31,
  })
  assert.deepEqual(calculateProductionGanttLayout(900, 31), {
    gridWidth: 510,
    cellWidth: 22,
  })
})

test("APS chart-only layout dedicates full width to the timeline", () => {
  assert.deepEqual(calculateProductionGanttLayout(1524, 30, true), {
    gridWidth: 0,
    cellWidth: 44,
  })
  assert.deepEqual(calculateProductionGanttLayout(600, 31, true), {
    gridWidth: 0,
    cellWidth: 22,
  })
})

test("APS renders composite nomenclature line for orders list", () => {
  assert.equal(
    formatApsItemCompositeLine({
      itemNomenclature: "0,5 л PET",
      packagingFormat: null,
      itemSku: "SKU-42",
      packagingProfile: "water",
      itemCode: "WATER-05",
      code: "PLN-1",
    }),
    "0,5 л PET · вода · арт. SKU-42"
  )
})

test("APS locks reserved plans and reports material coverage", () => {
  const tasks = productionPlansToGanttTasks([
    plan({
      status: "reserved",
      materials: [
        plan().materials[0],
        { ...plan().materials[0], planMaterialId: "2", shortageQty: 10 },
      ],
    }),
  ])
  assert.equal(tasks[1].readonly, true)
  assert.equal(tasks[1].progress, 50)
  assert.equal(tasks[1].color, "#10b981")
})

test("APS backend modules used by :3000 and :3001 stay synchronized", () => {
  for (const relativePath of [
    "lib/wms/production-plan-directory.ts",
    "lib/wms/errors.ts",
  ]) {
    const interfaceFile = path.resolve(scriptDir, "..", relativePath)
    const backendFile = path.resolve(scriptDir, "..", "..", relativePath)
    const normalize = (value) => value.replace(/\r\n/g, "\n")
    assert.equal(
      normalize(fs.readFileSync(interfaceFile, "utf8")),
      normalize(fs.readFileSync(backendFile, "utf8")),
      `${relativePath} differs between frontend and backend`
    )
  }
})
