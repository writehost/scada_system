import type { PoolClient } from "pg";

export type WmsOperationEventInput = {
  siteId: number;
  eventType: string;
  actorUserId?: string | number | null;
  deviceUid?: string | null;
  documentId?: string | number | null;
  itemId?: string | number | null;
  locationId?: string | number | null;
  codeValue?: string | null;
  payload?: Record<string, unknown> | null;
};

export async function logWmsOperationEvent(client: PoolClient, input: WmsOperationEventInput) {
  await client.query(
    `
    INSERT INTO wms_operation_events (
      site_id, event_type, actor_user_id, device_uid, document_id, item_id, location_id, code_value, payload_json
    )
    VALUES (
      $1, $2, NULLIF($3, '')::bigint, NULLIF($4, ''), NULLIF($5, '')::bigint,
      NULLIF($6, '')::bigint, NULLIF($7, '')::bigint, NULLIF($8, ''), $9::jsonb
    )
    `,
    [
      input.siteId,
      input.eventType.trim(),
      input.actorUserId == null ? "" : String(input.actorUserId),
      input.deviceUid?.trim() ?? "",
      input.documentId == null ? "" : String(input.documentId),
      input.itemId == null ? "" : String(input.itemId),
      input.locationId == null ? "" : String(input.locationId),
      input.codeValue?.trim() ?? "",
      JSON.stringify(input.payload ?? {}),
    ]
  );
}
