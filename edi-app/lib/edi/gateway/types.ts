export type ExchangeStatus = "received" | "queued" | "sent" | "delivered" | "accepted" | "rejected" | "clarification" | "error" | "unknown"
export type ProviderCapabilities = { incoming: boolean; outgoing: boolean; send: boolean; receipts: boolean; signatures: boolean; counterparties: boolean; roaming: boolean }
export type ExternalDocument = {
  externalId: string; direction: "in" | "out"; status: ExchangeStatus
  number?: string; date?: string; senderInn?: string; recipientInn?: string
  metadata: Record<string, unknown>
  files: Array<{ name: string; mime: string; bytes: Uint8Array; sha256: string }>
}
export type DocumentBatch = { documents: ExternalDocument[]; nextCursor: string | null; hasMore: boolean }
export type ConnectionConfig = { config: Record<string, unknown>; secret: string; externalOrgId: string | null }
export interface EdiProviderAdapter {
  code: string
  name: string
  verifiedOn: "sandbox" | "production"
  documentationUrl: string
  capabilities: ProviderCapabilities
  checkConnection(config: ConnectionConfig): Promise<{ ok: boolean; externalOrgId?: string; participantId?: string }>
  getDocument(config: ConnectionConfig, externalId: string): Promise<ExternalDocument>
  getDocumentStatus(config: ConnectionConfig, externalId: string): Promise<ExchangeStatus>
  getIncomingDocuments?(config: ConnectionConfig, cursor: string | null): Promise<DocumentBatch>
  getOutgoingDocuments?(config: ConnectionConfig, cursor: string | null): Promise<DocumentBatch>
  sendDocument?(config: ConnectionConfig, document: ExternalDocument, idempotencyKey: string): Promise<{ externalId: string; status: ExchangeStatus }>
  getReceipts?(config: ConnectionConfig, externalId: string): Promise<Array<{ externalId: string; kind: string; bytes: Uint8Array }>>
  getSignatures?(config: ConnectionConfig, externalId: string): Promise<Array<{ externalId: string; bytes: Uint8Array }>>
  getCounterparties?(config: ConnectionConfig, cursor: string | null): Promise<{ parties: Array<{ externalId: string; inn: string; kpp?: string; reachable: boolean; roamingVerified: boolean }>; nextCursor: string | null }>
}
