export type WmsAuthUserRecord = {
  fio: string
  position: string
  login: string
  password: string
}

export type WmsAuthSession = {
  userId?: string
  login: string
  fio: string
  position: string
  roleCodes?: string[]
  exp: number
  /** Время выдачи (мс). Старые cookie без поля считаются выданными за TTL до exp. */
  iat?: number
}

export const WMS_SESSION_COOKIE = "yms_session"
