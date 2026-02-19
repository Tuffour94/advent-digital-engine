import type { ScoutReport, EvidenceItem } from "@/lib/scout";
import { computeConfidence, evidenceUrls, findEvidence, hasEvidence, type CapRule, type PenaltyRule } from "@/lib/enforcement";

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

  const categories: CategoryScore[] = [];

  // Helpers for quality
  const pages = report.pages_checked || [];
  const pageCount = pages.length;
  const avgFetchMs = pageCount ? Math.round(pages.reduce((acc: number, p: any) => acc + (p.fetch_ms ?? 0), 0) / pageCount) : 0;
  const avgTextLen = pageCount ? Math.round(pages.reduce((acc: number, p: any) => acc + (p.text_length ?? 0), 0) / pageCount) : 0;
  const avgAltRatio = (() => {
    const imgs = pages.reduce((acc: number, p: any) => acc + (p.img_count ?? 0), 0);
    const alts = pages.reduce((acc: number, p: any) => acc + (p.img_alt_count ?? 0), 0);
    return imgs ? alts / imgs : 1;
  })();

  const httpsYes = pages.some((p: any) => p.has_https) ? true : false;

  // 1) Mission/Identity (20)
  {
    const weight = 20;
    const missionFound = has(report, "mission.keyword") || has(report, "adventist.keyword") || s.has_about_or_beliefs;
    const score = missionFound ? 18 : 6;
    categories.push({
      key: "mission_identity",
      label: "Mission / Identity",
      score,
      weight,
      reasons: [reason(missionFound, "Mission/identity signals detected", "No strong mission/identity signals detected")],
    });
  }

  // 2) Contact/Visitability (20)
  {
    const weight = 20;
    const contactStrong = s.has_contact && (has(report, "service_times.keyword") || has(report, "contact.keyword"));
    const score = contactStrong ? 18 : s.has_contact ? 12 : 3;
    categories.push({
      key: "contact_visitability",
      label: "Contact / Visitability",
      score,
      weight,
      reasons: [reason(s.has_contact, "Contact path detected", "No clear contact path detected")],
    });
  }

  // 3) Events/Freshness (20)
  {
    const weight = 20;
    const score = s.has_events ? 15 : 4;
    categories.push({
      key: "events_freshness",
      label: "Events / Freshness",
      score,
      weight,
      reasons: [reason(s.has_events, "Events/calendar signals detected", "No events/calendar signals detected")],
    });
  }

  // 4) Giving/Support (20)
  {
    const weight = 20;
    const provider = hasPrefix(report, "giving.");
    const score = s.has_giving ? (provider ? 20 : 16) : 3;
    categories.push({
      key: "giving_support",
      label: "Giving / Support",
      score,
      weight,
      reasons: [
        reason(s.has_giving, "Giving/donation path detected", "No giving path detected"),
        reason(provider, "Giving provider detected", "No known giving provider detected"),
      ].filter(Boolean),
    });
  }

  // 5) Media/Sermons (20)
  {
    const weight = 20;
    const found = has(report, "media.youtube_embed") || has(report, "media.keyword") || s.has_livestream;
    const score = found ? 16 : 4;
    categories.push({
      key: "media_sermons",
      label: "Media / Sermons",
      score,
      weight,
      reasons: [reason(found, "Media/sermon signals detected", "No sermon/media/livestream signals detected")],
    });
  }

  // 6) Website Quality (20) — UX + Content + Trust + Maintenance proxies
  {
    const weight = 20;

    // Speed proxy: avg fetch ms
    const speedLevel = avgFetchMs === 0 ? 5 : avgFetchMs < 1200 ? 20 : avgFetchMs < 2500 ? 15 : avgFetchMs < 4000 ? 10 : 5;

    const viewportFound = pages.some((p: any) => p.has_viewport_meta);
    const mobileLevel = viewportFound && s.has_responsive_css_hint ? 20 : viewportFound ? 15 : 5;

    const contentLevel = avgTextLen > 2500 ? 20 : avgTextLen > 1400 ? 15 : avgTextLen > 700 ? 10 : 5;

    const a11yLevel = avgAltRatio > 0.7 ? 15 : avgAltRatio > 0.3 ? 10 : 5;

    const maintenancePenalty = Math.min(10, (s.broken_nav_links.length || 0) * 3);

    // Combine levels (cap to 20)
    const combined = clamp(Math.round((speedLevel + mobileLevel + contentLevel + a11yLevel) / 4) - Math.round(maintenancePenalty / 4), 0, 20);

    categories.push({
      key: "website_quality",
      label: "Website Quality",
      score: combined,
      weight,
      reasons: [
        `Speed proxy: avg fetch ~${avgFetchMs}ms`,
        viewportFound ? "Mobile: viewport meta detected" : "Mobile: viewport meta missing",
        `Content depth proxy: avg text ~${avgTextLen} chars`,
        `Accessibility proxy: alt coverage ~${Math.round(avgAltRatio * 100)}%`,
        s.broken_nav_links.length ? `Maintenance: ${s.broken_nav_links.length} broken nav links sampled` : "Maintenance: no broken nav links detected",
      ],
    });
  }

  const raw_total = categories.reduce((sum, c) => sum + c.score, 0); // 0–120
  let ekklesiaScore = clamp(Math.round((raw_total / 120) * 100), 0, 100);

  const strengths: string[] = [];
  const red_flags: string[] = [];
  const priority_actions: string[] = [];

  const caps: CapRule[] = [];
  const penalties: PenaltyRule[] = [];
  const flags = computeConfidence(report);

  const catMap: Record<string, CategoryScore> = Object.fromEntries(categories.map((c) => [c.key, c]));

  if (catMap.mission_identity.score >= 15) strengths.push("Clear mission/identity signals on public pages");
  else priority_actions.push("Add a clear mission statement + ‘Who we are’ summary above the fold");

  if (catMap.events_freshness.score >= 12) strengths.push("Events/Calendar signals present");
  else {
    red_flags.push("No events/calendar signals detected");
    priority_actions.push("Add an Events/Calendar page and keep it updated monthly");
  }

  if (catMap.giving_support.score >= 15) strengths.push("Giving/donation path detected");
  else {
    red_flags.push("No online giving link detected");
    priority_actions.push("Add a Give/Donate link in main navigation (with a trusted provider)");
  }

  if (catMap.media_sermons.score >= 12) strengths.push("Sermon/media signals detected");
  else {
    red_flags.push("No sermon/media/livestream signals detected");
    priority_actions.push("Add a Sermons/Messages page and link it from the main navigation");
  }

  if (catMap.contact_visitability.score >= 12) strengths.push("Contact/visit path detected");
  else {
    red_flags.push("No clear contact path detected");
    priority_actions.push("Add a Contact page with service times, address, phone/email, and a simple contact form");
  }

  if (catMap.website_quality.score < 10) {
    red_flags.push("Website quality signals are weak (speed/mobile/content/trust)");
    priority_actions.push("Improve site usability: speed, mobile layout, content depth, and accessibility basics");
  }

  // Caps / confidence rules
  const lowConfidence = pageCount < 3;
  if (lowConfidence) {
    ekklesiaScore = Math.min(ekklesiaScore, 60);
    caps.push({
      rule_id: "CAP_LOW_PAGES",
      cap_max: 60,
      title: "<3 pages checked",
      evidence_check_ids: [],
      evidence_urls: report.pages_checked.map((p: any) => p.final_url).slice(0, 3),
    });
  }
  if (!httpsYes) {
    ekklesiaScore = Math.min(ekklesiaScore, 65);
    caps.push({
      rule_id: "CAP_NO_HTTPS",
      cap_max: 65,
      title: "No HTTPS detected",
      evidence_check_ids: [],
      evidence_urls: report.pages_checked.map((p: any) => p.final_url).slice(0, 3),
    });
  }
  if (catMap.contact_visitability.score < 8) {
    ekklesiaScore = Math.min(ekklesiaScore, 65);
    caps.push({
      rule_id: "CAP_NO_CONTACT",
      cap_max: 65,
      title: "No Contact/Visitability",
      evidence_check_ids: ["contact.keyword", "page.contact"],
      evidence_urls: evidenceUrls(findEvidence(report, "page.contact")).slice(0, 3),
    });
  }
  const brokenRate = report.signals.broken_nav_links.length / Math.max(1, 8);
  if (brokenRate > 0.1) {
    ekklesiaScore = Math.min(ekklesiaScore, 70);
    caps.push({
      rule_id: "CAP_BROKEN_NAV_10P",
      cap_max: 70,
      title: "Broken nav links >10% sample",
      evidence_check_ids: [],
      evidence_urls: report.signals.broken_nav_links.map((x: any) => x.url).slice(0, 8),
    });
  }
  if (caps.length) {
    red_flags.push("Enforcement caps applied due to quality/trust signals");
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

  const penalties_total = penalties.reduce((sum, p) => sum + p.points, 0);

  const website_quality_check: WebsiteQualityCheck = {
    speed: avgFetchMs < 2500 ? "pass" : avgFetchMs < 4000 ? "weak" : "fail",
    mobile: pages.some((p: any) => p.has_viewport_meta) ? "pass" : "fail",
    content_depth: avgTextLen > 1400 ? "pass" : avgTextLen > 700 ? "weak" : "fail",
    https: httpsYes ? "yes" : "no",
    navigation: report.signals.broken_nav_links.length === 0 ? "good" : report.signals.broken_nav_links.length <= 1 ? "fair" : "poor",
    maintenance: report.signals.broken_nav_links.length <= 1 ? "up_to_date" : "stale",
  };

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
    category_scores: catMap,
    evidence: report.evidence,
    pages_checked: report.pages_checked.map((p) => ({ url: p.final_url, status: p.status, title: p.title })),
    website_quality_check,
    enforcement: {
      caps,
      penalties,
      flags,
      a_grade_allowed: true,
    },
  };
}
