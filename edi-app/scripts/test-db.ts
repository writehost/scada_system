import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, test } from "node:test"
import { poolFromUrl } from "../lib/db.ts"
import { ensureEdiSchema, EDI_SCHEMA_VERSION } from "../lib/edi/schema.ts"

const url = process.env.EDI_TEST_DATABASE || ""
if (!url || new URL(url).pathname !== "/edi_validation") throw new Error("Use only an isolated edi_validation database")
const pool = poolFromUrl(url, 4)
before(async () => {
  const client = await pool.connect()
  try {
    await client.query(readFileSync(new URL("fixtures/wms-schema.sql", import.meta.url), "utf8"))
    await ensureEdiSchema(client)
  } finally { client.release() }
})
after(() => pool.end())

test("migrations: all versions applied once and repeat is idempotent", async () => {
  const client = await pool.connect()
  try {
    await ensureEdiSchema(client)
    assert.equal((await client.query("SELECT count(*)::int AS n FROM edi_schema_migrations")).rows[0].n, EDI_SCHEMA_VERSION)
    assert.equal((await client.query("SELECT version FROM edi_schema_meta WHERE id=1")).rows[0].version, EDI_SCHEMA_VERSION)
  } finally { client.release() }
})

test("migrations: checksum corruption refuses start and releases advisory lock", async () => {
  const client = await pool.connect()
  let original = ""
  try {
    original = (await client.query("SELECT checksum FROM edi_schema_migrations WHERE version=1")).rows[0].checksum
    await client.query("UPDATE edi_schema_migrations SET checksum='invalid' WHERE version=1")
    await assert.rejects(() => ensureEdiSchema(client), /checksum changed/)
    const other = await pool.connect()
    try {
      assert.equal((await other.query("SELECT pg_try_advisory_lock(hashtext('edi_schema')) AS ok")).rows[0].ok, true)
      await other.query("SELECT pg_advisory_unlock(hashtext('edi_schema'))")
    } finally { other.release() }
  } finally {
    if (original) await client.query("UPDATE edi_schema_migrations SET checksum=$1 WHERE version=1", [original])
    client.release()
  }
})

test("gateway: several accounts per provider, replay uniqueness and cross-tenant foreign keys", async () => {
  const client = await pool.connect()
  try {
    const a = (await client.query("INSERT INTO wms_sites(site_code,name) VALUES ('validation-a','A') RETURNING site_id")).rows[0].site_id
    const b = (await client.query("INSERT INTO wms_sites(site_code,name) VALUES ('validation-b','B') RETURNING site_id")).rows[0].site_id
    const first = (await client.query("INSERT INTO edi_provider_connections(site_id,provider,name) VALUES ($1,'diadoc','one') RETURNING connection_id", [a])).rows[0].connection_id
    await client.query("INSERT INTO edi_provider_connections(site_id,provider,name) VALUES ($1,'diadoc','two')", [a])
    assert.equal((await client.query("SELECT count(*)::int AS n FROM edi_provider_connections WHERE site_id=$1", [a])).rows[0].n, 2)
    const document = (await client.query("INSERT INTO edi_documents(site_id,doc_type,direction,title) VALUES ($1,'upd','in','validation') RETURNING document_id", [a])).rows[0].document_id
    await assert.rejects(() => client.query("INSERT INTO edi_external_instances(site_id,connection_id,document_id,external_id,direction,status) VALUES ($1,$2,$3,'foreign','in','received')", [b, first, document]), (error: unknown) => (error as { code: string }).code === "23503")
    const instance = (await client.query("INSERT INTO edi_external_instances(site_id,connection_id,document_id,external_id,direction,status) VALUES ($1,$2,$3,'original','in','received') RETURNING instance_id", [a, first, document])).rows[0].instance_id
    await assert.rejects(() => client.query("INSERT INTO edi_external_instances(site_id,connection_id,document_id,external_id,direction,status) VALUES ($1,$2,$3,'original','in','received')", [a, first, document]), (error: unknown) => (error as { code: string }).code === "23505")
    await assert.rejects(() => client.query("INSERT INTO edi_provider_events(site_id,instance_id,external_event_id,kind,occurred_at) VALUES ($1,$2,'event','received',now())", [b, instance]), (error: unknown) => (error as { code: string }).code === "23503")
  } finally { client.release() }
})
