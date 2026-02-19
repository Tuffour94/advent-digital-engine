// Deterministic scan cache key (must stay stable across UI/executor)

export const REPORT_SCHEMA_VERSION = 1;
export const SCOUT_VERSION = 2;
export const AUDITOR_VERSION = 3;

export type ScanInputs = {
  website_url: string;
  youtube_url?: string | null;
  facebook_url?: string | null;
};

export function normalizeInputs(inputs: ScanInputs) {
  return {
    website_url: String(inputs.website_url || "").trim(),
    youtube_url: String(inputs.youtube_url || "").trim() || null,
    facebook_url: String(inputs.facebook_url || "").trim() || null,
  };
}

export function scanCacheKeyObject(inputs: ScanInputs) {
  const n = normalizeInputs(inputs);
  return {
    report_schema_version: REPORT_SCHEMA_VERSION,
    scout_version: SCOUT_VERSION,
    auditor_version: AUDITOR_VERSION,
    inputs: n,
  };
}

export function scanInputHash(inputs: ScanInputs) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto");
  const key = scanCacheKeyObject(inputs);
  return crypto.createHash("sha256").update(JSON.stringify(key)).digest("hex");
}
