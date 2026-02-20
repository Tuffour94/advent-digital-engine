# Scoring v2 (WIP branch notes)

Branch: `scoring-v2-wip`

This branch is **visibility only**. Do not merge to `main`.

## What Scoring v2 changes are already in

### ✅ Continuous gradients (no cliff caps)
- Events/Freshness and Media/Sermons now score on **0.0–1.0 curves** (currently simplified based on recency booleans; TODO to use days).
- Trust/Visitability/Leadership are **laddered** (0.0–1.0) instead of binary 0/20.

### ✅ Weights sum to 100
Pillars (weights):
- Website Quality — 20
- UX & Navigation — 15
- Content Depth & Usefulness — 15
- Trust / Legitimacy (E-E-A-T proxies) — 15
- Events / Freshness — 15
- Media / Sermons — 10
- Giving / Support clarity — 10

Raw total is now **0–100** (no 0–120 normalization).

### ✅ Bounded penalties
- Penalty ledger still exists but total effect is **bounded**: `clamp(totalPenalties, -15, 0)`.

### ✅ Confidence dampening (not destruction)
- If `low_confidence_score` → apply a **small dampening** (currently ×0.9).
- Also logs a visible enforcement cap object describing low coverage as "dampened" (not a hard cap).

### ✅ Removal of fetch_ms as "speed"
- Removed fetch_ms from scoring and removed the fetch_ms penalty.
- Website Quality explicitly states PSI/CWV not integrated yet; **no fake speed score**.

### ✅ Evidence-backed + explainable
- Each pillar includes `reasons[]`.
- Enforcement ledger (caps/penalties) still carries evidence refs.

## TODO (explicit unfinished work)
1) **True gradient recency** using days since best_date
   - Scout currently stores `freshness.*.details.best_date` raw string.
   - TODO: parse into ISO + persist `days_since_*` in signals.

2) **Replace temporary HTTPS safety cap**
   - Currently caps at 70 if no HTTPS.
   - TODO: convert to soft trust penalty unless forms/PII collection detected.

3) **Calibration layer** (Commit 2 to main)
   - Percentile normalization or deterministic calibration config (distribution control).

4) **Public vs Connected Scan separation**
   - TODO: add explicit `scan_mode` and ensure connected-only signals are not scored in public scans.

5) **PageSpeed Insights integration**
   - TODO: add `PAGESPEED_API_KEY`, store `quality.pagespeed` artifact, use CWV for Website Quality.

## Test Plan (quick 5-site smoke)
Run these 5 scans and compare:
1) A weak/outdated church site (no events, no sermons) → expect **35–55**
2) A basic but functioning church site → expect **55–72**
3) A good modern church site with events + sermons + clear visitability → expect **72–85**
4) An excellent/professional site (rare) → expect **85–95**
5) A site with broken navigation or missing trust signals → should be **materially lower** than #3/#4

Signals that should visibly differ in the report:
- Events/Freshness pillar score (recent vs not)
- Trust pillar (about + leadership + address present vs missing)
- UX & Navigation pillar (CTA + broken links)
- Penalty ledger capped at -15 max
