/**
 * Шаблоны для массовых операций (текст «документа»).
 *
 * StateStatus: <1–8> { полный_скан1, полный_скан2 }
 * или многострочно после заголовка — по одному скану на строку.
 *
 * PartyAttr: метка_партии { сканы… }  — запись attr_id=1 (как в UI «Записать партию»).
 * Метка в кавычках, если есть пробелы: PartyAttr: "партия А" { … }
 */

export type ParsedBulkCommand =
  | { type: "stateStatus"; statusId: number; scans: string[] }
  | { type: "partyAttr"; batchText: string; scans: string[] };

function splitScans(inner: string): string[] {
  return inner
    .split(/[,;\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Основной разбор: один блок на документ (первое совпадение). */
export function parseBulkCommandDocument(raw: string): ParsedBulkCommand | null {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const party = parsePartyAttr(text);
  if (party) return party;

  const st = parseStateStatus(text);
  if (st) return st;

  return null;
}

function parsePartyAttr(text: string): ParsedBulkCommand | null {
  const m = text.match(
    /^\s*PartyAttr\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\{]+?))\s*\{([^}]*)\}\s*$/i
  );
  if (!m) return null;
  const batchText = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  if (!batchText) return null;
  const scans = splitScans(m[4] ?? "");
  if (scans.length === 0) return null;
  return { type: "partyAttr", batchText, scans };
}

function parseStateStatus(text: string): ParsedBulkCommand | null {
  const brace = text.match(
    /^\s*StateStatus\s*:\s*(\d+)\s*\{([^}]*)\}\s*$/i
  );
  if (brace) {
    const statusId = Number.parseInt(brace[1], 10);
    if (!Number.isFinite(statusId) || statusId < 1 || statusId > 8) return null;
    const scans = splitScans(brace[2] ?? "");
    if (scans.length === 0) return null;
    return { type: "stateStatus", statusId, scans };
  }

  const lines = text.split("\n").map((l) => l.trim());
  if (lines.length < 2) return null;
  const head = lines[0].match(/^\s*StateStatus\s*:\s*(\d+)\s*$/i);
  if (!head) return null;
  const statusId = Number.parseInt(head[1], 10);
  if (!Number.isFinite(statusId) || statusId < 1 || statusId > 8) return null;
  const scans = lines
    .slice(1)
    .filter((l) => l.length > 0 && !l.startsWith("//"));
  if (scans.length === 0) return null;
  return { type: "stateStatus", statusId, scans };
}

export const BULK_COMMAND_HELP = `Примеры:

StateStatus: 4 { 01046071389606622159ABC..., 01046071389606622159DEF... }

или:

StateStatus: 4
01046071389606622159первая_строка_скана
01046071389606622159вторая_строка_скана

PartyAttr: 11042026AB { скан1, скан2 }

PartyAttr: "моя партия" { скан1, скан2 }`;

/** Пункты для выпадающего меню «Примеры» — вставка в поле шаблона. */
export const BULK_DOCUMENT_EXAMPLES: { id: string; label: string; body: string }[] =
  [
    {
      id: "state-brace",
      label: "StateStatus — сканы в скобках",
      body: "StateStatus: 4 { 01046071389606622159ABC..., 01046071389606622159DEF... }",
    },
    {
      id: "state-multiline",
      label: "StateStatus — по строке на скан",
      body:
        "StateStatus: 4\n01046071389606622159первая_строка_скана\n01046071389606622159вторая_строка_скана",
    },
    {
      id: "party",
      label: "PartyAttr — метка без пробелов",
      body: "PartyAttr: 11042026AB { скан1, скан2 }",
    },
    {
      id: "party-quoted",
      label: "PartyAttr — метка в кавычках",
      body: 'PartyAttr: "моя партия" { скан1, скан2 }',
    },
  ];

/** Список сканов для верхнего поля — как при экспорте/импорте CSV. */
export const EXAMPLE_SCANS_CSV = `scan
01046071389606622159ABC...
01046071389606606622159DEF...`;

/**
 * Шаблон в виде CSV: одна операция на все строки (одинаковый kind / status_id / batch).
 * Колонки: kind, status_id, batch, scan
 */
export const EXAMPLE_TEMPLATE_CSV_STATE = `kind,status_id,batch,scan
StateStatus,4,,01046071389606622159line1
StateStatus,4,,01046071389606622159line2`;

export const EXAMPLE_TEMPLATE_CSV_PARTY = `kind,status_id,batch,scan
PartyAttr,,11042026AB,scan1
PartyAttr,,11042026AB,scan2`;

/** JSON для шаблона — можно «Собрать в текст» для поля «Шаблон». */
export const EXAMPLE_TEMPLATE_JSON_STATE = JSON.stringify(
  {
    type: "StateStatus",
    statusId: 4,
    scans: [
      "01046071389606622159line1",
      "01046071389606622159line2",
    ],
  },
  null,
  2
);

export const EXAMPLE_TEMPLATE_JSON_PARTY = JSON.stringify(
  {
    type: "PartyAttr",
    batch: "11042026AB",
    scans: ["scan1", "scan2"],
  },
  null,
  2
);

/** Пример тела для HTTP-моста emit-events (не тот же форм, что gRPC JSON). */
export const EXAMPLE_HTTP_EMIT_EVENTS_JSON = JSON.stringify(
  {
    site_id: 1,
    items: [
      {
        raw_hash: "5784897850725302324",
        status_id: 4,
        event_type_id: 4,
      },
    ],
  },
  null,
  2
);

export const EXAMPLE_HTTP_SEARCH_JSON = JSON.stringify(
  {
    site_id: 1,
    page_size: 100,
    page_token: "",
    gtin: "04607138960662",
    serial: "",
    status_id: 0,
    pool_id: 0,
  },
  null,
  2
);

/** JSON из примера → текст для поля «Шаблон» (StateStatus / PartyAttr). */
export function jsonToBulkTemplateText(raw: string): string | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const t = r.type;
  if (t === "StateStatus") {
    const statusId = Number(r.statusId);
    const scans = r.scans;
    if (
      !Number.isFinite(statusId) ||
      statusId < 1 ||
      statusId > 8 ||
      !Array.isArray(scans) ||
      scans.length === 0
    ) {
      return null;
    }
    const lines = scans.map((s) => String(s).trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return `StateStatus: ${statusId}\n${lines.join("\n")}`;
  }
  if (t === "PartyAttr") {
    const batch = String(r.batch ?? "").trim();
    const scans = r.scans;
    if (!batch || !Array.isArray(scans) || scans.length === 0) return null;
    const list = scans.map((s) => String(s).trim()).filter(Boolean);
    if (list.length === 0) return null;
    const q = /[\s,]/.test(batch) ? `"${batch.replace(/"/g, '\\"')}"` : batch;
    return `PartyAttr: ${q} { ${list.join(", ")} }`;
  }
  return null;
}

/**
 * Упрощённый CSV → текст шаблона. Первая строка — заголовок:
 * kind,status_id,batch,scan
 */
export function csvTemplateToBulkText(csv: string): string | null {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const kindIdx = header.indexOf("kind");
  const statusIdx = header.indexOf("status_id");
  const batchIdx = header.indexOf("batch");
  const scanIdx = header.indexOf("scan");
  if (kindIdx === -1 || scanIdx === -1) return null;

  const rows = lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === "," && !q) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    return cells;
  });

  const get = (row: string[], idx: number) =>
    idx >= 0 && idx < row.length ? row[idx].trim() : "";

  const kind0 = get(rows[0] ?? [], kindIdx).toLowerCase();
  if (kind0 === "statestatus") {
    const statusId = Number.parseInt(get(rows[0] ?? [], statusIdx), 10);
    if (!Number.isFinite(statusId) || statusId < 1 || statusId > 8) return null;
    const scans = rows
      .map((row) => get(row, scanIdx))
      .filter((s) => s.length > 0);
    if (scans.length === 0) return null;
    return `StateStatus: ${statusId}\n${scans.join("\n")}`;
  }
  if (kind0 === "partyattr") {
    const batch = get(rows[0] ?? [], batchIdx);
    if (!batch) return null;
    const scans = rows
      .map((row) => get(row, scanIdx))
      .filter((s) => s.length > 0);
    if (scans.length === 0) return null;
    const q = /[\s,]/.test(batch) ? `"${batch.replace(/"/g, '\\"')}"` : batch;
    return `PartyAttr: ${q} { ${scans.join(", ")} }`;
  }
  return null;
}
