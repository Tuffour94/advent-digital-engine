import type { CategoryScore } from "@/lib/auditor";

export const SCORE_SCHEMA_VERSION = 2; // Scoring v2 schema

export const EXPECTED_PILLARS: Array<{ key: string; label: string; weight: number }> = [
  { key: "website_quality", label: "Website Quality", weight: 20 },
  { key: "ux_navigation", label: "UX & Navigation", weight: 15 },
  { key: "content_depth", label: "Content Depth & Usefulness", weight: 15 },
  { key: "trust_eeat", label: "Trust / Legitimacy", weight: 15 },
  { key: "events_freshness", label: "Events / Freshness", weight: 15 },
  { key: "media_sermons", label: "Media / Sermons", weight: 10 },
  { key: "giving_support", label: "Giving / Support", weight: 10 },
];

export function normalizeCategoryScores(input: any): Record<string, CategoryScore> {
  const out: Record<string, CategoryScore> = {};

  // Preserve any existing categories (but coerce shape).
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      const c: any = v ?? {};
      if (!c || typeof c !== "object") continue;
      out[k] = {
        key: String(c.key ?? k),
        label: String(c.label ?? k),
        score: Number.isFinite(c.score) ? Number(c.score) : 0,
        weight: Number.isFinite(c.weight) ? Number(c.weight) : 0,
        reasons: Array.isArray(c.reasons) ? c.reasons.map(String) : [],
      };
    }
  }

  // Ensure all expected pillars exist.
  for (const p of EXPECTED_PILLARS) {
    if (!out[p.key]) {
      out[p.key] = { key: p.key, label: p.label, weight: p.weight, score: 0, reasons: [] };
    } else {
      // Fill label/weight if missing
      if (!out[p.key].label) out[p.key].label = p.label;
      if (!out[p.key].weight) out[p.key].weight = p.weight;
      if (!Array.isArray(out[p.key].reasons)) out[p.key].reasons = [];
      if (!Number.isFinite(out[p.key].score)) out[p.key].score = 0;
    }
  }

  return out;
}

export function validateCategoryScoresStrict(cat: Record<string, CategoryScore>) {
  for (const p of EXPECTED_PILLARS) {
    const c = cat?.[p.key];
    if (!c) return { ok: false as const, error: `missing pillar: ${p.key}` };
    if (typeof c.score !== "number") return { ok: false as const, error: `pillar ${p.key} score not number` };
    if (typeof c.weight !== "number") return { ok: false as const, error: `pillar ${p.key} weight not number` };
    if (!Array.isArray(c.reasons)) return { ok: false as const, error: `pillar ${p.key} reasons not array` };
  }
  return { ok: true as const };
}
