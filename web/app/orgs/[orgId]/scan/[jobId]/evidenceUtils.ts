export type EvidenceRow = {
  check_id: string;
  url: string;
  found: boolean;
  snippet?: string | null;
};

export function evidenceCategory(e: EvidenceRow) {
  return e.check_id.split(".")[0] || "other";
}

export function dedupeEvidence(rows: EvidenceRow[]) {
  const seen = new Set<string>();
  const out: EvidenceRow[] = [];

  for (const r of rows) {
    const cat = evidenceCategory(r);

    // provider-ish rows: dedupe by check_id + url origin
    let key = `${r.check_id}|${r.url}`;
    try {
      const u = new URL(r.url);
      key = `${r.check_id}|${u.origin}`;
    } catch {
      // ignore
    }

    // also prevent obvious duplicates
    const finalKey = `${cat}|${key}|${r.found ? "1" : "0"}`;
    if (seen.has(finalKey)) continue;
    seen.add(finalKey);

    out.push(r);
  }

  // Prefer FOUND rows first within same check_id
  out.sort((a, b) => {
    if (a.check_id === b.check_id) return Number(b.found) - Number(a.found);
    return a.check_id.localeCompare(b.check_id);
  });

  return out;
}

export function groupEvidence(rows: EvidenceRow[]) {
  const groups: Record<string, EvidenceRow[]> = {};
  for (const r of rows) {
    const c = evidenceCategory(r);
    groups[c] = groups[c] || [];
    groups[c].push(r);
  }
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
}
