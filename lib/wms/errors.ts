import { NextResponse } from "next/server";

export class WmsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "WmsHttpError";
  }
}

export function wmsErrorResponse(error: unknown) {
  if (error instanceof WmsHttpError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.status }
    );
  }
  const databaseError = error as { code?: string } | null;
  if (databaseError?.code === "42P01" || databaseError?.code === "42703") {
    return NextResponse.json(
      {
        error: "Схема базы данных устарела. Примените актуальные миграции WMS.",
        code: "db_schema_outdated",
      },
      { status: 503 }
    );
  }
  console.error(error);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
