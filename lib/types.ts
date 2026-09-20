/** Статус для бейджей (соответствует `code_state.status_id` / справочнику). */
export type MarkingUiStatus = "in_circulation" | "withdrawn" | "retired";

export interface MarkingCodeRow {
  id: string;
  /** Строка скана (raw), как в `codes.raw` */
  codeLine: string;
  /** `core.raw_hash` (uint64) — для gRPC ключей EmitEvents / UpsertAttributes */
  rawHash?: string;
  /** `state.status_id` (1…8), если пришёл из gRPC */
  statusIdNum?: number;
  /** AI(01) */
  gtin?: string;
  /** AI(21) */
  serial?: string;
  /** AI(93) tail из `core.ai93_tail`, hex (укороченно) */
  ai93TailHex?: string;
  status: MarkingUiStatus;
  statusLabel: string;
  /** `pool.pool_id` */
  poolId?: string;
  /** `pool.site_id` (площадка пула) */
  poolSiteId?: string;
  /**
   * Партия: `marking_pools.batch_label` или, если пула нет, текст `attrs` с attr_id=1 (batch_id).
   */
  batchLabel?: string;
  /** Кратко: attrs из ответа при `include: attrs` */
  attrsText?: string;
  /** `state.site_id` */
  siteIdState?: string;
  /** `state.location_id` (0 = нет) */
  locationId?: string;
  /** `state.line_id` (0 = нет) */
  lineId?: string;
  /** `core.created_at` */
  coreCreatedAt?: string;
  /** `state.updated_at` */
  stateUpdatedAt?: string;
  emittedAt?: string;
  printedAt?: string;
  appliedAt?: string;
  introducedAt?: string;
  retiredAt?: string;
  /** Кратко: последние события при `include: events:N` */
  eventsSummary?: string;
  /** Произвольное примечание для UI (интеграции с внешними системами); в codesvc пока нет. */
  note?: string;
}

export type SearchMode = "datamatrix" | "gtin" | "serial";
