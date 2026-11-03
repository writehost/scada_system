// Тестовая замена `next/headers`: вне запроса Next cookies/headers пусты.
export async function cookies() {
  return { get: (_name: string) => undefined as { value: string } | undefined, set: () => undefined }
}
export async function headers() {
  return new Headers()
}
