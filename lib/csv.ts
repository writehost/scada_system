import type { MarkingCodeRow } from "@/lib/types";

function esc(s: string) {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: MarkingCodeRow[]): string {
  const header = [
    "№",
    "raw_hash",
    "Код (скан)",
    "GTIN",
    "Серийный",
    "AI(93) hex",
    "POOL_ID",
    "Площадка пула",
    "Партия (пул или attr 1)",
    "Атрибуты",
    "Площадка (state)",
    "Локация",
    "Линия",
    "Создан (core)",
    "Обновлён (state)",
    "Эмиссия",
    "Печать",
    "Нанесён",
    "Ввод в оборот",
    "Списание",
    "События (последние)",
    "Статус",
    "Примечание",
  ];
  const lines = [header.join(",")];
  rows.forEach((r, i) => {
    lines.push(
      [
        String(i + 1),
        esc(r.rawHash ?? ""),
        esc(r.codeLine),
        esc(r.gtin ?? ""),
        esc(r.serial ?? ""),
        esc(r.ai93TailHex ?? ""),
        esc(r.poolId ?? ""),
        esc(r.poolSiteId ?? ""),
        esc(r.batchLabel ?? ""),
        esc(r.attrsText ?? ""),
        esc(r.siteIdState ?? ""),
        esc(r.locationId ?? ""),
        esc(r.lineId ?? ""),
        esc(r.coreCreatedAt ?? ""),
        esc(r.stateUpdatedAt ?? ""),
        esc(r.emittedAt ?? ""),
        esc(r.printedAt ?? ""),
        esc(r.appliedAt ?? ""),
        esc(r.introducedAt ?? ""),
        esc(r.retiredAt ?? ""),
        esc(r.eventsSummary ?? ""),
        esc(r.statusLabel),
        esc(r.note ?? ""),
      ].join(",")
    );
  });
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
