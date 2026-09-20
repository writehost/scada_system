/** OpenAI-compatible шлюз (не Timeweb Direct, не DeepSeek). Ключ только в env сервера. */

export type LlmChatMessage = { role: "system" | "user" | "assistant"; content: string }

export type LlmChatResult = {
  text: string
  model: string
}

function gatewayBase(): string {
  const raw = (process.env.WMS_LLM_BASE_URL || "http://193.233.220.205:4000/v1").trim()
  return raw.replace(/\/+$/, "")
}

function gatewayKey(): string {
  return (process.env.WMS_LLM_API_KEY || "").trim()
}

export function llmGatewayModel(): string {
  return (process.env.WMS_LLM_MODEL || "dashscope/qwen3.5-plus").trim()
}

export function llmGatewayConfigured(): boolean {
  return Boolean(gatewayKey())
}

export function humanizeLlmGatewayError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "шлюз ИИ недоступен")
  if (/\b401\b/.test(raw) || /incorrect api key|invalid api key|unauthorized/i.test(raw)) {
    return "Неверный ключ шлюза ИИ (401). Обновите WMS_LLM_API_KEY на сервере."
  }
  if (/\b404\b/.test(raw)) {
    return "Шлюз ИИ не найден (404): не тот URL или IP в блоклисте."
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|AbortError/i.test(raw)) {
    return "Нет связи со шлюзом ИИ. Проверьте, что 4000 доступен с WMS и ключ живой."
  }
  return raw
}

export async function llmChat(
  messages: LlmChatMessage[],
  options?: { timeoutMs?: number; signal?: AbortSignal; temperature?: number; maxTokens?: number }
): Promise<LlmChatResult> {
  const key = gatewayKey()
  if (!key) throw new Error("На сервере не задан WMS_LLM_API_KEY")
  const timeoutMs = options?.timeoutMs ?? 45_000
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const onParentAbort = () => ac.abort()
  options?.signal?.addEventListener("abort", onParentAbort)
  try {
    const res = await fetch(`${gatewayBase()}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: llmGatewayModel(),
        temperature: options?.temperature ?? 0,
        max_tokens: options?.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        messages,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 240) || "без тела"}`)
    }
    const payload = JSON.parse(text) as {
      model?: string
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = payload.choices?.[0]?.message?.content?.trim() || ""
    if (!content) throw new Error("Шлюз ИИ вернул пустой ответ")
    return { text: content, model: payload.model || llmGatewayModel() }
  } catch (error) {
    if (options?.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new Error("остановлено")
    }
    throw new Error(humanizeLlmGatewayError(error))
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener("abort", onParentAbort)
  }
}

export function extractJsonObject(raw: string): unknown {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim()
  const start = stripped.indexOf("{")
  if (start < 0) throw new Error("ИИ не вернул JSON")
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < stripped.length; i += 1) {
    const ch = stripped[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1)) as unknown
    }
  }
  throw new Error("ИИ не вернул JSON")
}
