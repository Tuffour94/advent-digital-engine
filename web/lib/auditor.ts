import type { ScoutReport, EvidenceItem } from "@/lib/scout";
import { computeConfidence, evidenceRefs, findEvidence, hasEvidence, type CapRule, type PenaltyRule } from "@/lib/enforcement";

export type CategoryScore = {
  key: string;
  label: string;
  score: number;
  weight: number;
  reasons: string[];
};

export type NextStep = {
  action: string;
  where: string;
  how: string;
  time_estimate?: string;

  // legacy (back-compat)
  title?: string;
  priority?: "high" | "medium" | "low";
  effort?: "low" | "medium" | "high";
  impact?: "low" | "medium" | "high";
};

export type WebsiteQualityCheck = {
  speed: "pass" | "weak" | "fail";
  mobile: "pass" | "weak" | "fail";
  content_depth: "pass" | "weak" | "fail";
  https: "yes" | "no";
  navigation: "good" | "fair" | "poor";
  maintenance: "up_to_date" | "stale";
};

export type AuditorScoreV2 = {
  ekklesiaScore: number; // normalized 0–100
  raw_total: number; // 0–120
  penalties_total: number;
  grade: string;
  strengths: string[];
  red_flags: string[];
  priority_actions: string[];
  top_wins: string[];
  top_risks: string[];
  recommended_next_steps: NextStep[];
  category_scores: Record<string, CategoryScore>; // each weight=20, raw_total sum=120
  evidence: EvidenceItem[];
  pages_checked: Array<{ url: string; status: number; title: string | null }>;
  website_quality_check: WebsiteQualityCheck;

  enforcement: {
    caps: CapRule[];
    penalties: PenaltyRule[];
    flags: {
      needs_deeper_crawl: boolean;
      low_confidence_score: boolean;
      missing_coverage_ratio: number;
    };
    a_grade_allowed: boolean;
  };
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function gradeFor(score: number) {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 55) return "C-";
  if (score >= 50) return "D";
  return "F";
}

function has(report: ScoutReport, checkId: string) {
  return report.evidence.some((e) => e.check_id === checkId && e.found);
}

function hasPrefix(report: ScoutReport, prefix: string) {
  return report.evidence.some((e) => e.check_id.startsWith(prefix) && e.found);
}

function reason(found: boolean, yes: string, no: string) {
  return found ? yes : no;
}

export function auditorFromScoutV2(report: ScoutReport): AuditorScoreV2 {
  const s = report.signals;

  // Evidence-gated scoring: if required evidence is missing, points must collapse.
  const gate = (requiredCheckIds: string[]) => {
    return requiredCheckIds.some((id) => has(report, id));
  };

  const categories: CategoryScore[] = [];

  // Helpers for quality (public scan only; do not fake CWV/true performance)
  const pages = report.pages_checked || [];
  const pageCount = pages.length;
  const avgTextLen = pageCount ? Math.round(pages.reduce((acc: number, p: any) => acc + (p.text_length ?? 0), 0) / pageCount) : 0;
  const avgAltRatio = (() => {
    const imgs = pages.reduce((acc: number, p: any) => acc + (p.img_count ?? 0), 0);
    const alts = pages.reduce((acc: number, p: any) => acc + (p.img_alt_count ?? 0), 0);
    return imgs ? alts / imgs : 1;
  })();

  const httpsYes = pages.some((p: any) => p.has_https) ? true : false;

  // Scoring v2 (WIP): continuous gradients + weights sum to 100.
  // NOTE: This is a PUBLIC scan. Do not claim Core Web Vitals / true performance without PSI.

  const score01 = (x: number) => clamp(x, 0, 1);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  // Gradients
  const freshness01 = (recent90: boolean, hasAny: boolean) => (recent90 ? 1 : hasAny ? 0.4 : 0);
  const sermons01 = (recent6mo: boolean, hasAny: boolean) => (recent6mo ? 1 : hasAny ? 0.35 : 0);
  const leadership01 = (hasLeadership: boolean) => (hasLeadership ? 0.7 : 0);
  const address01 = (hasAddress: boolean) => (hasAddress ? 0.7 : 0);
  const contact01 = (hasContact: boolean, hasTimes: boolean) => (hasContact ? (hasTimes ? 1 : 0.65) : 0);
  const cta01 = (hasCta: boolean) => (hasCta ? 1 : 0.4);

  // Navigation quality proxy (bounded)
  const broken = s.broken_nav_links?.length ?? 0;
  const nav01 = score01(1 - Math.min(1, broken / 6));

  // Content usefulness proxy (NOT just length): combine moderate text depth + structure proxy.
  const avgH2 = pageCount ? Math.round(pages.reduce((acc: number, p: any) => acc + (p.h2_count ?? 0), 0) / pageCount) : 0;
  const textDepth01 = avgTextLen >= 2800 ? 1 : avgTextLen >= 1600 ? 0.75 : avgTextLen >= 900 ? 0.55 : avgTextLen >= 450 ? 0.35 : 0.15;
  const structure01 = avgH2 >= 4 ? 1 : avgH2 >= 2 ? 0.7 : avgH2 >= 1 ? 0.5 : 0.25;
  const contentUsefulness01 = score01(0.6 * textDepth01 + 0.4 * structure01);

  // Accessibility proxy (alt coverage)
  const a11y01 = avgAltRatio >= 0.8 ? 1 : avgAltRatio >= 0.6 ? 0.75 : avgAltRatio >= 0.35 ? 0.5 : avgAltRatio >= 0.2 ? 0.35 : 0.2;

  const viewportFound = pages.some((p: any) => p.has_viewport_meta);
  const mobile01 = viewportFound ? (s.has_responsive_css_hint ? 0.9 : 0.75) : 0.25;

  // Pillars (weights sum to 100)
  const pillars: Array<{ key: string; label: string; weight: number; score01: number; reasons: string[] }> = [];

  // Website Quality (performance/mobile/accessibility) — 20
  pillars.push({
    key: "website_quality",
    label: "Website Quality",
    weight: 20,
    score01: score01(0.45 * mobile01 + 0.35 * a11y01 + 0.2 * nav01),
    reasons: [
      viewportFound ? "Mobile: viewport meta detected" : "Mobile: viewport meta missing",
      `Accessibility proxy: alt coverage ~${Math.round(avgAltRatio * 100)}%`,
      broken ? `Maintenance: ${broken} broken nav links sampled` : "Maintenance: no broken nav links detected",
      "Performance: PSI/Core Web Vitals not available in Public Scan yet (no fake speed score).",
    ],
  });

  // UX & Navigation clarity — 15
  pillars.push({
    key: "ux_navigation",
    label: "UX & Navigation",
    weight: 15,
    score01: score01(0.55 * nav01 + 0.25 * cta01(s.has_homepage_cta) + 0.2 * (s.has_contact ? 1 : 0.4)),
    reasons: [
      s.has_homepage_cta ? "Homepage CTA detected" : "Homepage CTA missing/weak",
      broken ? `Broken nav links sampled: ${broken}` : "No broken nav links detected",
    ],
  });

  // Content depth & usefulness — 15
  pillars.push({
    key: "content_depth",
    label: "Content Depth & Usefulness",
    weight: 15,
    score01: contentUsefulness01,
    reasons: [`Content proxy: avg text ~${avgTextLen} chars`, `Structure proxy: avg h2 ~${avgH2}`],
  });

  // Trust/E-E-A-T proxies — 15
  const trust01 = score01(0.34 * leadership01(s.has_leadership_info) + 0.33 * address01(s.has_physical_address) + 0.33 * (s.has_about_or_beliefs ? 1 : 0.25));
  pillars.push({
    key: "trust_eeat",
    label: "Trust / Legitimacy",
    weight: 15,
    score01: trust01,
    reasons: [
      s.has_about_or_beliefs ? "About/mission/beliefs detected" : "About/mission/beliefs not clearly detected",
      s.has_leadership_info ? "Leadership info detected" : "Leadership info not detected",
      s.has_physical_address ? "Physical address detected" : "Physical address not detected",
    ],
  });

  // Events/Freshness — 15
  pillars.push({
    key: "events_freshness",
    label: "Events / Freshness",
    weight: 15,
    score01: freshness01(s.events_recent_90d, s.has_events),
    reasons: [reason(s.has_events, "Events/calendar signals detected", "No events/calendar signals detected")],
  });

  // Media/Sermons — 10
  const mediaAny = has(report, "media.youtube_embed") || has(report, "media.keyword") || s.has_livestream;
  pillars.push({
    key: "media_sermons",
    label: "Media / Sermons",
    weight: 10,
    score01: sermons01(s.sermons_recent_6mo, mediaAny),
    reasons: [reason(mediaAny, "Media/sermon signals detected", "No sermon/media/livestream signals detected")],
  });

  // Giving/Support clarity — 10 (presence should not inflate score)
  const givingProvider = hasPrefix(report, "giving.");
  const giving01 = s.has_giving ? (givingProvider ? 0.85 : 0.7) : 0;
  pillars.push({
    key: "giving_support",
    label: "Giving / Support",
    weight: 10,
    score01: giving01,
    reasons: [reason(s.has_giving, "Giving/donation path detected", "No giving path detected")],
  });

  // Evidence gating: if evidence is missing, dampen the specific pillar (not cliff).
  const gatePillar = (pillarKey: string, checkIds: string[], dampTo: number) => {
    const ok = gate(checkIds);
    if (!ok) {
      const p = pillars.find((x) => x.key === pillarKey);
      if (p) p.score01 = Math.min(p.score01, dampTo);
      return false;
    }
    return true;
  };

  gatePillar("events_freshness", ["freshness.events_90d", "page.events", "events.keyword"], 0.25);
  gatePillar("media_sermons", ["freshness.sermons_6mo", "page.media", "media.keyword", "media.youtube_embed"], 0.25);
  gatePillar("trust_eeat", ["trust.leadership_info", "trust.physical_address", "page.about"], 0.35);

  // Convert to CategoryScore[]
  for (const p of pillars) {
    categories.push({
      key: p.key,
      label: p.label,
      weight: p.weight,
      score: Math.round(p.weight * p.score01),
      reasons: p.reasons,
    });
  }

  const raw_total = categories.reduce((sum, c) => sum + c.score, 0); // 0–100
  let ekklesiaScore = clamp(raw_total, 0, 100);

  const strengths: string[] = [];
  const red_flags: string[] = [];
  const priority_actions: string[] = [];

  const caps: CapRule[] = [];
  const penalties: PenaltyRule[] = [];
  const flags = computeConfidence(report);

  // (gate helper declared above)

  const catMap: Record<string, CategoryScore> = Object.fromEntries(categories.map((c) => [c.key, c]));

  // Defensive: always initialize all 7 expected pillars (prevents runtime crashes).
  const expected: Array<{ key: string; label: string; weight: number }> = [
    { key: "website_quality", label: "Website Quality", weight: 20 },
    { key: "ux_navigation", label: "UX & Navigation", weight: 15 },
    { key: "content_depth", label: "Content Depth & Usefulness", weight: 15 },
    { key: "trust_eeat", label: "Trust / Legitimacy", weight: 15 },
    { key: "events_freshness", label: "Events / Freshness", weight: 15 },
    { key: "media_sermons", label: "Media / Sermons", weight: 10 },
    { key: "giving_support", label: "Giving / Support", weight: 10 },
  ];
  for (const e of expected) {
    if (!catMap[e.key]) catMap[e.key] = { key: e.key, label: e.label, weight: e.weight, score: 0, reasons: [] };
  }

  const scoreOf = (k: string) => catMap[k]?.score ?? 0;

  // Strengths / risks (defensive, no assumptions about pillar existence)
  if (scoreOf("trust_eeat") >= 11) strengths.push("Clear trust/legitimacy signals (about/leadership/address) detected");
  else priority_actions.push("Improve trust signals: add About/Beliefs, leadership bios, and a clear address/map/service times");

  if (scoreOf("events_freshness") >= 10) strengths.push("Events/Calendar freshness signals present");
  else {
    red_flags.push("Events freshness looks weak (or not detectable)");
    priority_actions.push("Add an Events/Calendar page and keep it updated monthly");
  }

  if (scoreOf("media_sermons") >= 7) strengths.push("Sermon/media signals present");
  else {
    red_flags.push("Sermon/media signals look weak (or not detectable)");
    priority_actions.push("Add a Sermons/Messages page and link it from the main navigation");
  }

  if (scoreOf("giving_support") >= 6) strengths.push("Giving/support path detected");
  else {
    red_flags.push("Giving/support path not detected");
    priority_actions.push("Add a Give/Donate link in the main navigation (trusted provider) — do not hide it");
  }

  if (scoreOf("ux_navigation") < 7) {
    red_flags.push("UX/navigation clarity looks weak (CTA, navigation, broken links)");
    priority_actions.push("Improve homepage clarity (Plan a Visit / Watch / Give) and clean up navigation");
  }

  if (scoreOf("website_quality") < 8) {
    red_flags.push("Website quality signals are weak (public scan proxies only)");
    priority_actions.push("Improve mobile layout and accessibility basics; run PSI once integrated for Core Web Vitals");
  }

  // Scoring v2: confidence dampening (do not destroy the score)
  const lowConfidence = pageCount < 3;
  if (lowConfidence) {
    caps.push({
      rule_id: "CAP_LOW_PAGES_SAFETY",
      cap_max: 0,
      title: "Low coverage (<3 pages checked) — score dampened (not capped)",
      evidence: report.pages_checked.slice(0, 3).map((p: any) => ({ check_id: "pages_checked", url: p.final_url, snippet: p.title ?? null, status: p.status })),
    });
  }

  // Minimal “safety cap” (WIP): HTTPS.
  // TODO: replace with soft trust penalty unless we detect forms/PII collection.
  if (!httpsYes) {
    caps.push({
      rule_id: "CAP_NO_HTTPS_SAFETY",
      cap_max: 70,
      title: "No HTTPS detected — safety cap (temporary)",
      evidence: report.pages_checked.slice(0, 3).map((p: any) => ({ check_id: "https", url: p.final_url, snippet: "URL is not https", status: p.status })),
    });
    ekklesiaScore = Math.min(ekklesiaScore, 70);
  }

  const top_wins = strengths.slice(0, 3);
  const top_risks = red_flags.slice(0, 3);

  const recommended_next_steps: NextStep[] = [
    {
      action: "Strengthen mission statement",
      where: "Homepage (top section) + About page",
      how: "Add a 2–3 sentence mission summary above the fold. Link to an About/Beliefs page from the main navigation.",
      time_estimate: "~1–2 hours",
    },
    {
      action: "Create/refresh Events page",
      where: "Main navigation + /events or /calendar",
      how: "Publish upcoming programs with dates. Update monthly so visitors can see what’s happening next.",
      time_estimate: "~1–2 hours",
    },
    {
      action: "Add an online giving link",
      where: "Main navigation + homepage",
      how: "Add a “Give” button linking to your giving provider (e.g., AdventistGiving/Tithe.ly/Pushpay).",
      time_estimate: "~30 minutes",
    },
    {
      action: "Improve sermon/media depth",
      where: "Main navigation + Sermons/Messages page",
      how: "Link to an archive (playlist/channel). Ensure the last 3–6 messages are easy to find.",
      time_estimate: "~2–4 hours",
    },
    {
      action: "Improve contact clarity",
      where: "Footer + Contact page",
      how: "Add service times, address, phone/email, and a simple contact form. Include a map link.",
      time_estimate: "~1–2 hours",
    },
  ].slice(0, 8);

  // Penalty ledger (negative weighting)
  if (!s.has_homepage_cta) {
    penalties.push({
      rule_id: "P_NO_HOMEPAGE_CTA",
      points: -6,
      title: "No clear homepage CTA",
      evidence: evidenceRefs(findEvidence(report, "ux.homepage_cta"), 1),
    });
  }

  if (avgAltRatio < 0.6) {
    penalties.push({
      rule_id: "P_ALT_MISSING_40P",
      points: -5,
      title: "Alt tags missing on many images",
      evidence: report.pages_checked.slice(0, 2).map((p: any) => ({
        check_id: "a11y.alt_coverage",
        url: p.final_url,
        snippet: `alt coverage proxy low (page images: ${p.img_count}, with alt: ${p.img_alt_count})`,
        status: p.status,
      })),
    });
  }

  // NOTE (Scoring v2): do NOT use crawler fetch_ms as “speed”. PSI/Core Web Vitals integration pending.

  if (!s.has_sitemap) {
    penalties.push({
      rule_id: "P_NO_SITEMAP",
      points: -3,
      title: "No sitemap.xml detected",
      evidence: evidenceRefs(findEvidence(report, "trust.sitemap"), 1),
    });
  }

  // Readability proxies (reuse avgH2 computed above)
  if (avgTextLen > 4000 && avgH2 < 2) {
    penalties.push({
      rule_id: "P_DENSE_TEXT",
      points: -5,
      title: "Dense/unstructured text blocks",
      evidence: report.pages_checked.slice(0, 1).map((p: any) => ({ check_id: "content.structure", url: p.final_url, snippet: `avg text ~${avgTextLen} chars, low headings`, status: p.status })),
    });
  }

  if (avgH2 === 0 && avgTextLen > 1200) {
    penalties.push({
      rule_id: "P_POOR_TYPOGRAPHY_PROXY",
      points: -4,
      title: "Weak heading/structure signals (readability proxy)",
      evidence: report.pages_checked.slice(0, 1).map((p: any) => ({ check_id: "content.headings", url: p.final_url, snippet: `h2_count ~${avgH2}`, status: p.status })),
    });
  }

  const penalties_total = penalties.reduce((sum, p) => sum + p.points, 0);

  // Scoring v2: remove hard caps as primary mechanism.
  // TODO: revisit whether any additional “safety caps” are warranted after PSI + security header checks.

  // Scoring v2: bounded penalty ledger (ceiling)
  const bounded_penalties_total = clamp(penalties_total, -15, 0);
  ekklesiaScore = clamp(ekklesiaScore + bounded_penalties_total, 0, 100);

  // Confidence dampening (small, not destructive)
  if (flags.low_confidence_score) ekklesiaScore = Math.round(ekklesiaScore * 0.9);

  // A-grade lock
  let a_grade_allowed = true;
  const websiteQuality = catMap.website_quality?.score ?? 0;
  const freshness = catMap.events_freshness?.score ?? 0;
  const contentDepth = catMap.content_depth?.score ?? 0;
  const ux = catMap.ux_navigation?.score ?? 0;

  if (caps.length) a_grade_allowed = false;
  if (flags.low_confidence_score) a_grade_allowed = false;
  if (websiteQuality < 17) a_grade_allowed = false;
  if (freshness < 12) a_grade_allowed = false;
  if (contentDepth < 10) a_grade_allowed = false;
  if (ux < 10) a_grade_allowed = false;
  if (!s.has_leadership_info || !s.has_physical_address) a_grade_allowed = false;

  if (!a_grade_allowed && ekklesiaScore >= 85) {
    ekklesiaScore = 84; // forbid A
    red_flags.push("A-grade lock applied (quality/freshness/confidence requirements not met)");
  }

  const website_quality_check: WebsiteQualityCheck = {
    speed: "weak", // Public scan: PSI/Core Web Vitals not integrated yet
    mobile: pages.some((p: any) => p.has_viewport_meta) ? "pass" : "fail",
    content_depth: avgTextLen > 1600 ? "pass" : avgTextLen > 900 ? "weak" : "fail",
    https: httpsYes ? "yes" : "no",
    navigation: report.signals.broken_nav_links.length === 0 ? "good" : report.signals.broken_nav_links.length <= 1 ? "fair" : "poor",
    maintenance: report.signals.broken_nav_links.length <= 1 ? "up_to_date" : "stale",
  };

  // Final schema normalization (never return missing pillars)
  const { normalizeCategoryScores } = require("@/lib/scoreSchema");
  const normalizedCatMap = normalizeCategoryScores(catMap);

  return {
    ekklesiaScore,
    raw_total,
    penalties_total,
    grade: gradeFor(ekklesiaScore),
    strengths: strengths.slice(0, 8),
    red_flags: red_flags.slice(0, 8),
    priority_actions: priority_actions.slice(0, 10),
    top_wins,
    top_risks,
    recommended_next_steps,
    category_scores: normalizedCatMap,
    evidence: report.evidence,
    pages_checked: report.pages_checked.map((p) => ({ url: p.final_url, status: p.status, title: p.title })),
    website_quality_check,
    enforcement: {
      caps,
      penalties,
      flags,
      a_grade_allowed,
    },
  };
}
