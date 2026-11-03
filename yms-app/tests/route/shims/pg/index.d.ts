// Типы, совместимые с используемым подмножеством пакета `pg` (только для тестового стенда).
export interface QueryResult<R = any> {
  rows: R[]
  rowCount: number | null
  command?: string
}
export type PoolConfig = Record<string, unknown>
export interface PoolClient {
  query<R = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>
  release(destroy?: boolean): void
}
export declare class Client {
  constructor(cfg?: unknown)
  connect(): Promise<void>
  query<R = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>
  on(event: string, cb: (...args: any[]) => void): this
  end(): Promise<void>
}
export declare class Pool {
  constructor(cfg?: unknown)
  connect(): Promise<PoolClient>
  query<R = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>
  end(): Promise<void>
}
declare const _default: { Pool: typeof Pool; Client: typeof Client }
export default _default
