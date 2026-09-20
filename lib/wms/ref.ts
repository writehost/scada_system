export const WMS_DOCUMENT_TYPE = {
  receiving: 1,
  putaway: 2,
  picking: 3,
  shipping: 4,
  transfer: 5,
  issue: 6,
  return: 7,
  revision: 8,
  replenishment: 9,
  interwarehouse_transfer: 10,
  production_consumption: 11,
  writeoff: 12,
} as const;

export const WMS_DOCUMENT_STATUS = {
  draft: 1,
  in_progress: 2,
  applied: 3,
  cancelled: 4,
  conflict: 5,
  failed: 6,
} as const;

export const WMS_MOVEMENT_TYPE = {
  receiving: 1,
  putaway: 2,
  picking: 3,
  shipping: 4,
  transfer: 5,
  issue: 6,
  return: 7,
  revision_adjustment: 8,
  replenishment: 9,
  interwarehouse_ship: 10,
  interwarehouse_receive: 11,
  production_consume: 12,
  writeoff: 13,
} as const;

export const WMS_STOCK_BUCKET = {
  available: 1,
  reserved: 2,
  in_production: 3,
  quarantine: 4,
  rejected: 5,
  in_transit: 6,
} as const;

export const WMS_TASK_TYPE = {
  receipt: 1,
  putaway: 2,
  replenishment: 3,
  internal_transfer: 4,
  interwarehouse_transfer: 5,
  issue_to_line: 6,
  return_from_line: 7,
  revision: 8,
  pick: 9,
  ship: 10,
} as const;

export const WMS_TASK_STATUS = {
  open: 1,
  claimed: 2,
  in_progress: 3,
  completed: 4,
  cancelled: 5,
  failed: 6,
  exception: 7,
  on_hold: 8,
} as const;

export const WMS_TASK_PRIORITY = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
} as const;
