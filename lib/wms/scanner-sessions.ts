export type WmsScannerMode = "info" | "collect";
export type WmsScannerSource = "tsd" | "serial";

export type WmsScannerScanEvent = {
  siteId: number;
  siteCode: string;
  sessionId: string;
  deviceUid?: string | null;
  source: WmsScannerSource;
  mode: WmsScannerMode;
  code: string;
  atIso: string;
};

export const WMS_SCAN_EVENTS_CHANNEL = "wms_scan_events";
