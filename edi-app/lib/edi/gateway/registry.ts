import type { EdiProviderAdapter } from "./types.ts"

// No production adapter is registered until official API and sandbox checks are complete.
export const adapters: ReadonlyMap<string, EdiProviderAdapter> = new Map()
export const providerCatalog = [
  { code: "diadoc", name: "Контур.Диадок" },
  { code: "saby", name: "СБИС / Saby" },
  { code: "taxcom", name: "Такском" },
  { code: "astral", name: "Калуга Астрал" },
].map((provider) => ({ ...provider, available: adapters.has(provider.code), reason: "Требуются API-доступ и подтверждённые испытания адаптера" }))
