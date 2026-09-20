import type { PoolClient } from "pg";
import type { StorageSlotProfile } from "@/lib/storage-slot-ui";
import { SLOT_PROFILE_FIELD_KEYS, type SlotProfileFieldKey } from "@/lib/wms/slot-profile-directory";

const FIELD_LABELS: Record<SlotProfileFieldKey, string> = {
  materialType: "Тип материала",
  processType: "Этап",
  stickerShape: "Форма",
  productGroup: "Линейка",
  volume: "Объём",
  applicationPlace: "Место нанесения",
  equipment: "Оборудование / линия",
};

/** Перед сохранением ячейки: все коды профиля должны быть в wms_slot_profile_option_defs. */
export async function ensureSlotProfileOptionDefs(
  client: PoolClient,
  siteId: number,
  profile: StorageSlotProfile | null | undefined
): Promise<void> {
  if (!profile) return;

  for (const fieldKey of SLOT_PROFILE_FIELD_KEYS) {
    const raw = profile[fieldKey as keyof StorageSlotProfile];
    const code = typeof raw === "string" ? raw.trim() : "";
    if (!code || code === "ANY") continue;

    const name =
      fieldKey === "equipment" && /^[A-Z0-9_-]+$/i.test(code)
        ? code.replace(/_/g, " ")
        : code;

    await client.query(
      `INSERT INTO wms_slot_profile_option_defs (
         site_id, field_key, option_code, name, sort_order, is_active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 500, TRUE, now(), now())
       ON CONFLICT (site_id, field_key, option_code)
       DO UPDATE SET
         name = CASE
           WHEN wms_slot_profile_option_defs.name = wms_slot_profile_option_defs.option_code
           THEN EXCLUDED.name
           ELSE wms_slot_profile_option_defs.name
         END,
         is_active = TRUE,
         updated_at = now()`,
      [siteId, fieldKey, code, name.slice(0, 200)]
    );
  }
}

export function slotProfileFieldLabel(fieldKey: SlotProfileFieldKey): string {
  return FIELD_LABELS[fieldKey] ?? fieldKey;
}
