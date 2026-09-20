const MAX_BULK_ERROR_LINES = 40;

/** Разбор `items` из EmitEvents / UpsertAttributes (поля `error_code` / `error_message`). */
export function summarizeBulkItems(items: unknown[]): {
  ok: number;
  failed: number;
  errors: string[];
} {
  const errors: string[] = [];
  let ok = 0;
  let failed = 0;
  let errorsOmitted = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") {
      ok++;
      continue;
    }
    const o = it as Record<string, unknown>;
    const ec = o.error_code ?? o.errorCode;
    const code = ec != null ? String(ec).trim() : "";
    if (code.length > 0) {
      failed++;
      const em = String(o.error_message ?? o.errorMessage ?? "").trim();
      const line = em.length > 0 ? `${code}: ${em}` : code;
      if (errors.length < MAX_BULK_ERROR_LINES) errors.push(line);
      else errorsOmitted++;
    } else {
      ok++;
    }
  }
  if (errorsOmitted > 0) {
    errors.push(`… ещё ${errorsOmitted} ошибок`);
  }
  return { ok, failed, errors };
}

/** Текст для `description` в тосте (многострочный). */
export function formatBulkErrorsDescription(errors: string[]): string | undefined {
  if (errors.length === 0) return undefined;
  return errors.join("\n");
}
