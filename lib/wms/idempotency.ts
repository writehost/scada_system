import type { Pool, PoolClient } from "pg";

export type Disposition = "applied" | "duplicate" | "conflict" | "failed";

export async function runIdempotentWrite<T extends Record<string, unknown>>(
  pool: Pool,
  requestId: string,
  siteId: number,
  operationCode: string,
  requestPayload: unknown,
  work: (client: PoolClient) => Promise<T>
): Promise<T & { disposition: Disposition }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [
      requestId,
    ]);
    const dup = await client.query<{
      response_payload: unknown;
    }>(
      `SELECT response_payload FROM wms_request_log WHERE request_id = $1::uuid`,
      [requestId]
    );
    if (dup.rows.length > 0) {
      const payload = dup.rows[0].response_payload as Record<
        string,
        unknown
      > | null;
      await client.query("COMMIT");
      if (payload && typeof payload === "object") {
        return { ...payload, disposition: "duplicate" } as T & {
          disposition: Disposition;
        };
      }
      return {
        disposition: "duplicate",
        message: "duplicate without stored payload",
      } as unknown as T & { disposition: Disposition };
    }
    const result = await work(client);
    const full = { ...result, disposition: "applied" as const };
    await client.query(
      `INSERT INTO wms_request_log (request_id, site_id, operation_code, request_status_id, request_payload, response_payload, applied_at)
       VALUES ($1::uuid, $2, $3, 1, $4::jsonb, $5::jsonb, now())`,
      [
        requestId,
        siteId,
        operationCode,
        JSON.stringify(requestPayload ?? {}),
        JSON.stringify(full),
      ]
    );
    await client.query("COMMIT");
    return full;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
