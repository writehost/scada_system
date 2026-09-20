/** Разбор строки CSV с учётом кавычек RFC-подобно (запятая/точка с запятой как разделитель). */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (((c === "," || c === ";") && !inQuotes) || (c === "\t" && !inQuotes)) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result.map((s) => s.replace(/^"|"$/g, "").trim());
}

/**
 * Из текста файла (.txt построчно или .csv экспорта реестра) — список строк сканов.
 * Для CSV с заголовком ищет колонку «Код (скан)» или первую колонку с полным сканом.
 */
export function extractScanLinesFromImportedFile(content: string): string[] {
  const raw = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return [];

  if (nonEmpty.length >= 2 && /^scan$/i.test(nonEmpty[0])) {
    return nonEmpty.slice(1).filter((l) => l.length > 0 && l !== "—");
  }

  const first = parseCsvLine(nonEmpty[0]);
  const looksHeader =
    first.some((c) => /№|^№$/i.test(c) || c === "№") ||
    first.some((c) => /код/i.test(c) && /скан/i.test(c)) ||
    first.some((c) => /^raw_hash$/i.test(c));

  let codeCol = -1;
  let startRow = 0;

  if (looksHeader && first.length > 1) {
    startRow = 1;
    const idx = first.findIndex(
      (c) =>
        (c.includes("Код") && c.includes("скан")) ||
        /^код\s*\(/i.test(c) ||
        c === "Код (скан)"
    );
    if (idx >= 0) codeCol = idx;
    else {
      const r = first.findIndex((c) => /^raw_hash$/i.test(c));
      if (r >= 0 && r + 1 < first.length) codeCol = r + 1;
    }
    if (codeCol < 0 && first.length > 2) {
      codeCol = 2;
    }
  }

  if (codeCol < 0) {
    codeCol = 0;
    startRow = 0;
    if (
      first.length >= 2 &&
      /^\d+$/.test(first[0].trim()) &&
      first[1].trim().length >= 8
    ) {
      codeCol = 1;
    }
  }

  const out: string[] = [];
  for (let i = startRow; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    if (!line.includes(",") && !line.includes(";") && !line.includes("\t")) {
      if (line.length > 0 && line !== "—") out.push(line);
      continue;
    }
    const cells = parseCsvLine(line);
    const v = (cells[codeCol] ?? "").trim();
    if (v.length > 0 && v !== "—") out.push(v);
  }

  return out;
}
