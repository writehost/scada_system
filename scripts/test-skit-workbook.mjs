import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import * as XLSX from "xlsx"

const require = createRequire(import.meta.url)
const file = process.argv[2]
if (!file) {
  console.error("Usage: node scripts/test-skit-workbook.mjs <path-to-xlsm>")
  process.exit(1)
}

// Inline minimal parse for smoke test (avoids TS import in .mjs)
const SHEET_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/

const buffer = readFileSync(file)
const wb = XLSX.read(buffer, { type: "buffer", cellDates: true })
const dateSheets = wb.SheetNames.filter((n) => SHEET_DATE_RE.test(n.trim()))
console.log("workbook sheets:", wb.SheetNames.length)
console.log("date sheets:", dateSheets.length, dateSheets.slice(0, 5).join(", "), "...")

for (const name of dateSheets.slice(0, 2)) {
  const ws = wb.Sheets[name]
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
  let headerRow = 18
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const b = matrix[i]?.[1]
    if (typeof b === "string" && b.trim().toLowerCase() === "дата") {
      headerRow = i
      break
    }
  }
  const headers = (matrix[headerRow] ?? []).slice(6, 12)
  console.log(`\n${name} headerRow=${headerRow} products:`, headers)
}
