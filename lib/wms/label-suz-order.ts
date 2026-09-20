import {
  getCryptoProCertificates,
  inferDetachedHashBitsFromThumbprint,
  signWaterBffDocumentDetached,
  type CryptoProCertInfo,
} from "@/lib/crypto-pro-sign"
import {
  cisTypeFromSticker,
  loadLabelSuzSettings,
  saveLabelSuzSettings,
  type LabelSuzSettings,
} from "@/lib/wms/label-suz-settings"
import { resolveSuzGroupForOrder, type ResolvedSuzGroup } from "@/lib/wms/label-suz-product-group"

export type SuzOrderDraft = {
  paymentType: number
  releaseMethodType: string
  productionOrderId: null
  factoryAddress: null
  factoryName: null
  products: Array<{
    templateId: number
    gtin: string
    quantity: number
    serialNumberType: string
    cisType: string
    productGroup: string
  }>
  productGroup: string
  omsId: string
}

export function buildSuzOrderDraft(input: {
  gtin: string
  quantity: number
  settings: LabelSuzSettings
  stickerType?: string
  group?: Pick<ResolvedSuzGroup, "productGroup" | "templateId">
}): SuzOrderDraft {
  const gtin = input.gtin.replace(/\D/g, "").padStart(14, "0").slice(-14)
  const quantity = Math.min(150_000, Math.max(1, Math.floor(input.quantity)))
  const cisType = cisTypeFromSticker(input.stickerType, input.settings.cisType)
  const productGroup = input.group?.productGroup ?? input.settings.productGroup
  const templateId = input.group?.templateId ?? input.settings.templateId
  return {
    paymentType: 2,
    releaseMethodType: "PRODUCTION",
    productionOrderId: null,
    factoryAddress: null,
    factoryName: null,
    products: [
      {
        templateId,
        gtin,
        quantity,
        serialNumberType: input.settings.serialNumberType,
        cisType,
        productGroup,
      },
    ],
    productGroup,
    omsId: input.settings.omsId,
  }
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

function normalizePkcs7Base64(signatureBase64: string): string {
  return signatureBase64.replace(/\r?\n|\s/g, "").trim()
}

export function extractUpstreamOrderId(data: Record<string, unknown>): string | null {
  for (const c of [data.orderId, data.order_id, data.OrderId, data.id]) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return null
}

export function kmCodesFromSuzOrderResponse(root: unknown): string[] {
  if (!root || typeof root !== "object") return []
  const codes = (root as Record<string, unknown>).codes
  if (!Array.isArray(codes)) return []
  return codes.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map((x) => x.trim())
}

async function signJson(payload: unknown, thumbprint: string) {
  const jsonUtf8 = JSON.stringify(payload)
  const inferred = await inferDetachedHashBitsFromThumbprint(thumbprint)
  const hashBits = inferred ?? 256
  const signed = await signWaterBffDocumentDetached(jsonUtf8, thumbprint, { hashBits })
  if (!signed.ok) throw new Error(signed.error)
  return {
    jsonUtf8,
    signature: normalizePkcs7Base64(signed.signatureBase64),
    contentBase64: toBase64Utf8(jsonUtf8),
  }
}

export async function loadSuzCertificates(): Promise<CryptoProCertInfo[]> {
  const res = await getCryptoProCertificates()
  if (!res.ok) throw new Error(res.error)
  return res.certificates
}

export type SignLabelOrderResult = {
  upstreamOrderId: string
  codes: string[]
  codesPending: boolean
  suzCreateResponse: Record<string, unknown>
  productGroup: string
  productGroupSource: ResolvedSuzGroup["source"]
}

/**
 * Подписать УКЭП → создать заказ в СУЗ → попытаться получить КМ.
 * Если буфер ещё пуст — возвращает codesPending=true (можно повторить «Получить КМ»).
 */
export async function signAndFetchCodesForLabelOrder(input: {
  gtin: string
  quantity: number
  stickerType?: string
  thumbprint: string
  settings?: LabelSuzSettings
  productGroupHints?: unknown[]
}): Promise<SignLabelOrderResult> {
  const settings = input.settings ?? loadLabelSuzSettings()
  if (!settings.omsId.trim()) throw new Error("Укажите omsId в настройках заказа кодов")
  if (!settings.clientToken.trim()) {
    throw new Error("Укажите clientToken СУЗ в настройках (токен из simpleSignIn / ЛК)")
  }
  if (!input.thumbprint.trim()) throw new Error("Выберите сертификат УКЭП")

  saveLabelSuzSettings({ ...settings, lastCertThumbprint: input.thumbprint })

  const group = await resolveSuzGroupForOrder({
    gtin: input.gtin,
    hints: input.productGroupHints,
    settings,
  })
  const draft = buildSuzOrderDraft({
    gtin: input.gtin,
    quantity: input.quantity,
    settings,
    stickerType: input.stickerType,
    group,
  })

  const signed = await signJson(draft, input.thumbprint)
  const createRes = await fetch("/api/wms/suz/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientToken: settings.clientToken,
      signature: signed.signature,
      content: signed.contentBase64,
      omsId: settings.omsId,
      suzBaseUrl: settings.suzBaseUrl,
    }),
  })
  const createData = (await createRes.json().catch(() => ({}))) as Record<string, unknown>
  if (!createRes.ok) {
    throw new Error(typeof createData.error === "string" ? createData.error : `СУЗ order HTTP ${createRes.status}`)
  }
  if (createData.success === false) {
    throw new Error(typeof createData.error === "string" ? createData.error : "СУЗ вернула success=false")
  }

  const upstreamOrderId = extractUpstreamOrderId(createData)
  if (!upstreamOrderId) throw new Error("СУЗ не вернула orderId")

  // Небольшая пауза — буфер часто появляется не мгновенно
  await new Promise((r) => setTimeout(r, 1500))

  let codes: string[] = []
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      codes = await fetchCodesFromSuzOrder({
        orderId: upstreamOrderId,
        gtin: draft.products[0].gtin,
        quantity: draft.products[0].quantity,
        thumbprint: input.thumbprint,
        settings,
      })
      if (codes.length > 0) break
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }

  return {
    upstreamOrderId,
    codes,
    codesPending: codes.length === 0,
    suzCreateResponse: createData,
    productGroup: group.productGroup,
    productGroupSource: group.source,
  }
}

export async function fetchCodesFromSuzOrder(input: {
  orderId: string
  gtin: string
  quantity: number
  thumbprint: string
  settings?: LabelSuzSettings
}): Promise<string[]> {
  const settings = input.settings ?? loadLabelSuzSettings()
  const { signature } = await signJson({}, input.thumbprint)
  const gtin = input.gtin.replace(/\D/g, "").padStart(14, "0").slice(-14)
  const res = await fetch("/api/wms/suz/codes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientToken: settings.clientToken,
      signature,
      omsId: settings.omsId,
      orderId: input.orderId,
      gtin,
      quantity: input.quantity,
      suzBaseUrl: settings.suzBaseUrl,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `СУЗ codes HTTP ${res.status}`)
  }
  const codes = kmCodesFromSuzOrderResponse(data)
  if (codes.length === 0) {
    throw new Error("СУЗ не вернула коды (буфер ещё не готов или исчерпан)")
  }
  return codes
}
