// Deterministic scan cache key (must stay stable across UI/executor)

export const REPORT_SCHEMA_VERSION = 2;
export const SCOUT_VERSION = 3;
export const AUDITOR_VERSION = 4;

export type ScanInputs = {
  website_url: string;
  youtube_url?: string | null;
  facebook_url?: string | null;
};

function normalizeUrlMaybe(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";

  // Accept inputs like "example.com" or "www.example.com" by assuming https.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;

  try {
    const u = new URL(withScheme);
    // Canonicalize: drop hash, trim trailing slash (except root), keep protocol+host+path+query
    u.hash = "";
    const out = u.toString();
    return out.endsWith("/") && u.pathname !== "/" ? out.slice(0, -1) : out;
  } catch {
    // If still invalid, return original trimmed (executor will throw a clear error)
    return s;
  }
}

export function normalizeInputs(inputs: ScanInputs) {
  return {
    website_url: normalizeUrlMaybe(inputs.website_url),
    youtube_url: inputs.youtube_url ? normalizeUrlMaybe(inputs.youtube_url) : null,
    facebook_url: inputs.facebook_url ? normalizeUrlMaybe(inputs.facebook_url) : null,
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
