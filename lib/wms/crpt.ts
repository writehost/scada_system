export const CRPT_INFO_URL =
  process.env.WMS_CRPT_INFO_URL?.trim() || "https://scada25.ru/gsmt/api/service/crpt/info";

const GS = "\x1d";
/** Как в GSMT: серийник потребительской единицы, дальше криптохвост 91/92/93. */
const GS1_MARKING_SERIAL_LENGTH = 13;

function stripQuotes(code: string): string {
  return code.trim().replace(/^["']|["']$/g, "").replace(/^\uFEFF/, "");
}

/**
 * Сканер/вставка вместо ASCII GS (0x1D) перед AI 91/92/93 часто даёт `~`.
 * Нельзя забирать `)` перед 93: у напитков серийник 13 символов, `)` — обычный знак AI 21.
 */
function replaceScannerGsBeforeCryptoAi(s: string): string {
  let r = s.replace(/\u00e8/g, "");
  r = r.replace(/~(?=9[123])/g, GS);
  r = r.replace(/\u241D(?=9[123])/g, GS);
  r = r.replace(/\{GS\}(?=9[123])/gi, GS);
  r = r.replace(/\u2194(?=9[123])/g, GS);
  r = r.replace(/^(01\d{14}21[\s\S]{7,}?)[=+\-](?=9[123])/, `$1${GS}`);
  r = r.replace(/\((9[123])\)\s*/g, `${GS}$1`);
  r = r.replace(/\((\d{2,4})\)\s*/g, "$1");
  return r;
}

/** Санитизация как у GSMT `markingCodeForCisInfoRequest`: GS перед 91/92/93, хвост не выкидаем. */
export function markingCodeForCisInfoRequest(raw: string): string {
  let s = replaceScannerGsBeforeCryptoAi(stripQuotes(raw));
  if (!s) return s;

  const letterSerial = s.match(/^01(\d{14})(?!21)([A-Za-z][\s\S]*)$/);
  if (letterSerial) s = `01${letterSerial[1]}21${letterSerial[2]}`;

  const unit = s.match(/^01(\d{14})21([\s\S]+)$/);
  if (unit && !unit[2].includes(GS)) {
    const gtin = unit[1];
    const tail = unit[2];
    if (tail.length > GS1_MARKING_SERIAL_LENGTH && /^9[123]/.test(tail.slice(GS1_MARKING_SERIAL_LENGTH))) {
      s = `01${gtin}21${tail.slice(0, GS1_MARKING_SERIAL_LENGTH)}${GS}${tail.slice(GS1_MARKING_SERIAL_LENGTH)}`;
    } else {
      const trail93 = tail.match(/^([\s\S]+?)(93[A-Za-z0-9'"/+._-]{4})$/);
      if (trail93) s = `01${gtin}21${trail93[1]}${GS}${trail93[2]}`;
    }
  }
  return s;
}

/** Убирает криптохвост (AI 91/92/93) — как GSMT `normalizeCode`. */
export function stripCrptCryptoTail(code: string): string {
  const s = markingCodeForCisInfoRequest(code);
  if (!s) return s;
  const cuts = [91, 92, 93]
    .map((ai) => s.indexOf(`${GS}${ai}`))
    .filter((idx) => idx > 0)
    .sort((a, b) => a - b);
  if (cuts.length > 0) return s.slice(0, cuts[0]);

  const gsParen93 = s.indexOf(`${GS}(93)`);
  if (gsParen93 >= 0) return s.slice(0, gsParen93);

  const trailingParen93 = s.match(/^(.+?)\(93\)[^()]*$/i);
  if (trailingParen93) return trailingParen93[1];

  const trailing = s.match(/^(01\d{14}.+?)(93[\x21-\x22\x25-\x2F\x30-\x39\x41-\x5A\x5F\x61-\x7A]{4,})$/);
  if (trailing) return trailing[1];

  return s;
}

/** GS1 Data Matrix с AI в скобках → компактный КМ для CRPT: 01 + GTIN14 + 21 + serial. */
export function compactGs1MarkedCode(code: string): string {
  const s = code.trim();
  if (!s) return s;

  const parenUnit = s.match(/^\(01\)(\d{14})(?:\(21\)([\s\S]+))?$/i);
  if (parenUnit) {
    const gtin = parenUnit[1];
    const serial = (parenUnit[2] ?? "").trim();
    return serial ? `01${gtin}21${serial}` : `01${gtin}`;
  }

  const gtinHead = s.match(/^\(01\)(\d{14})/i);
  if (gtinHead) {
    const rest = s.slice(gtinHead[0].length);
    const serialMatch = rest.match(/^\(21\)([\s\S]+?)(?:\(\d{2}\)|$)/i);
    if (serialMatch) return `01${gtinHead[1]}21${serialMatch[1].trim()}`;
  }

  return s;
}

/** Компактный КМ без AI 21 после GTIN → формат ЧЗ: 01 + GTIN14 + 21 + serial.
 *  Не вставляем 21 перед цифрой: иначе `…206215SDM` / опечатка `…2064215` ломают КИ. */
export function ensureCrptSerialAi(code: string): string {
  const m = code.match(/^01(\d{14})(?!21)([A-Za-z][\s\S]*)$/);
  if (!m) return code;
  return `01${m[1]}21${m[2]}`;
}

/** Код для отображения оператору: компактный GS1 без скобок AI и без криптохвоста 93. */
export function formatMarkingCodeDisplay(code: string): string {
  const stripped = stripCrptCryptoTail(code.trim());
  if (!stripped) return stripped;
  if (/\(\d{2}\)/.test(stripped)) {
    return compactGs1MarkedCode(stripped);
  }
  return stripped.replace(/\u001d/g, "");
}

function addCisShapeVariants(add: (value: string) => void, short: string): void {
  const bases = short.endsWith(")") ? [short, short.slice(0, -1)] : [short];
  for (const base of bases) {
    add(base);
    const extraDigitBefore21 = base.match(/^01(\d{14})\d21([\s\S]+)$/);
    if (extraDigitBefore21) {
      add(`01${extraDigitBefore21[1]}21${extraDigitBefore21[2]}`);
    }
    // Лишняя цифра в GTIN (сканер: 04600… вместо 046070…): 01 + 15 цифр + 21 + serial.
    const gtin15 = base.match(/^01(\d{15})21([\s\S]+)$/);
    if (gtin15) {
      const digits = gtin15[1];
      const serial = gtin15[2];
      for (let i = 0; i < digits.length; i++) {
        if (digits[i] !== "0") continue;
        add(`01${digits.slice(0, i)}${digits.slice(i + 1)}21${serial}`);
      }
    }
    const unit = base.match(/^01(\d{14})21([\s\S]+)$/);
    if (unit) {
      const gtin = unit[1];
      const tail = unit[2];
      if (tail.length > GS1_MARKING_SERIAL_LENGTH) {
        add(`01${gtin}21${tail.slice(0, GS1_MARKING_SERIAL_LENGTH)}`);
      }
      const drop6 = tail.match(/^(.{7,}?)([A-Za-z0-9]{6})$/);
      if (drop6) add(`01${gtin}21${drop6[1]}`);
      const drop4 = tail.match(/^(.{7,}?)([A-Za-z0-9]{4})$/);
      if (drop4) add(`01${gtin}21${drop4[1]}`);
    }
  }
}

/** Варианты КИ для GSMT/ЧЗ: короткий без крипты, обрезка хвоста сканера, полный поток. */
export function cisLookupVariants(raw: string): string[] {
  const full = markingCodeForCisInfoRequest(compactGs1MarkedCode(stripQuotes(raw)));
  const short = stripCrptCryptoTail(full).replace(/\u001d/g, "");
  const out: string[] = [];
  const add = (value: string) => {
    const next = value.replace(/\u001d/g, "").trim();
    if (next && !out.includes(next)) out.push(next);
  };
  addCisShapeVariants(add, short);
  add(full);
  add(stripQuotes(raw));
  return out;
}

/** Нормализация кода маркировки для POST /api/wms/crpt/info — как инспектор GSMT (короткий КИ). */
export function normalizeCrptCode(code: string): string {
  return cisLookupVariants(code)[0] || "";
}

/**
 * Несколько КИ в одном поле: перевод строки, `;`, или запятая только перед следующим `01`/`00`.
 * Запятая внутри серийника (AI 21) — часть кода, её нельзя резать.
 */
export function splitCrptCodeList(input: string): string[] {
  return input
    .split(/(?:\r?\n|;+|,(?=\s*(?:01|00|\(01\))))/)
    .map((part) => stripQuotes(part))
    .filter(Boolean);
}

/** Склеивает осколки, если клиент всё же разрезал КИ по запятой в серийнике. */
export function rejoinCommaSerialFragments(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = stripQuotes(part);
    if (!trimmed) continue;
    const prev = out[out.length - 1];
    const nextIsNewCis = /^(?:01|00|\(01\))/.test(trimmed);
    if (prev && /^01\d/.test(prev) && !nextIsNewCis) {
      out[out.length - 1] = `${prev},${trimmed}`;
      continue;
    }
    out.push(trimmed);
  }
  return out;
}

/** Сырые коды из запроса — варианты для ЧЗ собирает `fetchCrptInfoFromUpstream`. */
export function parseCrptCodes(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? rejoinCommaSerialFragments(input.map((value) => String(value ?? "")))
    : typeof input === "string"
      ? splitCrptCodeList(input)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw) {
    const trimmed = stripQuotes(part);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

type CrptResponseItem = {
  cisInfo?: Record<string, unknown> | null;
  errorMessage?: unknown;
  errorCode?: unknown;
};

function asCrptItems(payload: unknown): CrptResponseItem[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((item): item is CrptResponseItem => item != null && typeof item === "object");
}

function isValidCrptCisInfo(cisInfo: unknown): boolean {
  if (!cisInfo || typeof cisInfo !== "object") return false;
  const rec = cisInfo as Record<string, unknown>;
  const gtin = String(rec.gtin ?? "").trim();
  const productName = String(rec.productName ?? "").trim();
  const status = String(rec.status ?? "").trim();
  return Boolean(gtin || productName || status);
}

function extractCrptErrorMessage(payload: unknown): string | null {
  const items = asCrptItems(payload);
  if (items.length === 0) return null;

  const messages = items
    .map((item) => {
      const msg = String(item.errorMessage ?? "").trim();
      if (msg) return msg;
      const code = String(item.errorCode ?? "").trim();
      return code ? `CRPT error ${code}` : "";
    })
    .filter(Boolean);

  if (messages.length > 0) return messages.join("; ");

  const hasAnyCis = items.some((item) => isValidCrptCisInfo(item.cisInfo));
  if (!hasAnyCis) return "ЧЗ не вернул данных по коду";

  return null;
}

function assertCrptPayload(payload: unknown): unknown {
  const err = extractCrptErrorMessage(payload);
  if (err) {
    const notFound = asCrptItems(payload).some(
      (item) => String(item.errorCode ?? "").trim() === "404"
    );
    const e = new Error(err) as Error & { code?: string };
    e.code = notFound ? "crpt_not_found" : "crpt_upstream_error";
    throw e;
  }
  return payload;
}

async function postCrptCodesToGsmt(
  codes: string[],
  bearerToken?: string | null
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const token = bearerToken?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(CRPT_INFO_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ codes }),
    cache: "no-store",
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const crptError = extractCrptErrorMessage(payload);
    const upstreamError =
      crptError ||
      (payload && typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "")
        : "");
    const message = upstreamError || text.trim() || `CRPT upstream HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        token
          ? `${message} (проверьте Bearer-токен для CRPT upstream)`
          : `${message} (нужен Bearer-токен для CRPT upstream — задайте WMS_CRPT_BEARER_TOKEN на сервере)`
      );
    }
    const e = new Error(message) as Error & { code?: string };
    if (res.status === 404 || message.includes("не найден")) {
      e.code = "crpt_not_found";
    }
    throw e;
  }

  return assertCrptPayload(payload);
}

function isNotFoundCrptError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "crpt_not_found" || /не найден|ЧЗ не вернул/i.test(message);
}

export async function fetchCrptInfoFromUpstream(
  codes: string[],
  bearerToken?: string | null
): Promise<unknown> {
  const variantLists = codes.map((code) => cisLookupVariants(code));
  const max = Math.max(1, ...variantLists.map((list) => list.length));
  const seen = new Set<string>();
  let lastError: unknown = null;

  for (let i = 0; i < max; i++) {
    const batch = variantLists.map((list) => list[Math.min(i, list.length - 1)] ?? "");
    const key = batch.join("\n");
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    try {
      return await postCrptCodesToGsmt(batch, bearerToken);
    } catch (error) {
      lastError = error;
      if (!isNotFoundCrptError(error)) throw error;
    }
  }

  const tried = [...seen].map((row) => row.replace(/\u001d/g, "")).filter(Boolean);
  if (lastError instanceof Error) {
    if (tried.length > 0 && !lastError.message.includes(tried[0])) {
      lastError.message = `${lastError.message} (${tried.slice(0, 3).join(" · ")})`;
    }
    throw lastError;
  }
  throw new Error(tried.length ? `ЧЗ не вернул данных по коду (${tried[0]})` : "ЧЗ не вернул данных по коду");
}
