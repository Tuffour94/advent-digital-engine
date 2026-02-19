import type { ScoutReport, EvidenceItem } from "@/lib/scout";

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

export type AuditorScoreV2 = {
  ekklesiaScore: number;
  grade: string;
  strengths: string[];
  red_flags: string[];
  priority_actions: string[];
  top_wins: string[];
  top_risks: string[];
  recommended_next_steps: NextStep[];
  category_scores: Record<string, CategoryScore>;
  evidence: EvidenceItem[];
  pages_checked: Array<{ url: string; status: number; title: string | null }>;
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

  // Mission clarity (0-20)
  {
    const weight = 20;
    const missionFound = has(report, "mission.keyword") || has(report, "adventist.keyword") || s.has_about_or_beliefs;
    const score = missionFound ? 18 : 6;
    categories.push({
      key: "mission_clarity",
      label: "Mission clarity",
      score,
      weight,
      reasons: [reason(missionFound, "Mission/identity signals detected", "No strong mission/identity signals detected")],
    });
  }

  // Events / Calendar (0-15)
  {
    const weight = 15;
    const found = s.has_events;
    const score = found ? 12 : 3;
    categories.push({
      key: "events",
      label: "Events / Calendar",
      score,
      weight,
      reasons: [reason(found, "Events/calendar signals detected", "No events/calendar signals detected")],
    });
  }

  // Giving / Support (0-15)
  {
    const weight = 15;
    const found = s.has_giving;
    const provider = hasPrefix(report, "giving.");
    const score = found ? (provider ? 15 : 12) : 2;
    categories.push({
      key: "giving",
      label: "Giving / Support",
      score,
      weight,
      reasons: [
        reason(found, "Giving/donation path detected", "No giving path detected"),
        reason(provider, "Giving provider detected (Tithe.ly/Pushpay/Subsplash/AdventistGiving)", "No known giving provider detected"),
      ].filter(Boolean),
    });
  }

  // Media / Livestream / Sermons (0-15)
  {
    const weight = 15;
    const found = has(report, "media.youtube_embed") || has(report, "media.keyword") || s.has_livestream;
    const score = found ? 12 : 4;
    categories.push({
      key: "media",
      label: "Media / Livestream / Sermons",
      score,
      weight,
      reasons: [reason(found, "Media/livestream/sermon signals detected", "No sermon/media/livestream signals detected")],
    });
  }

  // Contact clarity (0-15)
  {
    const weight = 15;
    const found = s.has_contact;
    const score = found ? 15 : 2;
    categories.push({
      key: "contact",
      label: "Contact clarity",
      score,
      weight,
      reasons: [reason(found, "Contact signals detected (contact page/phone/email/address)", "No clear contact path detected")],
    });
  }

  // Mobile UX (0-10)
  {
    const weight = 10;
    const viewportFound = report.pages_checked.some((p) => p.has_viewport_meta);
    const responsiveHint = s.has_responsive_css_hint;
    const found = viewportFound || responsiveHint;
    const score = found ? 9 : 2;
    categories.push({
      key: "mobile",
      label: "Mobile UX",
      score,
      weight,
      reasons: [
        reason(viewportFound, "Viewport meta detected", "Missing viewport meta"),
        reason(responsiveHint, "Responsive CSS/media-query hint detected", "No responsive hint detected"),
      ],
    });
  }

  // Broken links / Trust (0-10)
  {
    const weight = 10;
    const brokenNav = s.broken_nav_links.length;
    const score = clamp(10 - brokenNav * 3, 0, 10);
    categories.push({
      key: "broken_links",
      label: "Broken links / Trust",
      score,
      weight,
      reasons: [brokenNav ? `${brokenNav} nav links returned 4xx/5xx` : "No broken nav links detected in sample"],
    });
  }

  const total = categories.reduce((sum, c) => sum + c.score, 0);
  const ekklesiaScore = clamp(Math.round(total), 0, 100);

  const strengths: string[] = [];
  const red_flags: string[] = [];
  const priority_actions: string[] = [];

  const catMap: Record<string, CategoryScore> = Object.fromEntries(categories.map((c) => [c.key, c]));

  if (catMap.mission_clarity.score >= 15) strengths.push("Clear mission/identity signals on public pages");
  else priority_actions.push("Add a clear mission statement + ‘Who we are’ summary above the fold");

  if (catMap.events.score >= 10) strengths.push("Events/Calendar signals present");
  else {
    red_flags.push("No events/calendar signals detected");
    priority_actions.push("Add an Events/Calendar page and keep it updated weekly");
  }

  if (catMap.giving.score >= 12) strengths.push("Giving/donation path detected");
  else {
    red_flags.push("No online giving link detected");
    priority_actions.push("Add a Give/Donate link in main navigation (with a trusted provider)");
  }

  if (catMap.media.score >= 10) strengths.push("Sermon/media signals detected");
  else {
    red_flags.push("No sermon/media/livestream signals detected");
    priority_actions.push("Add Sermons/Messages page and embed recent content (YouTube is fine)");
  }

  if (catMap.contact.score >= 12) strengths.push("Contact path detected");
  else {
    red_flags.push("No clear contact path detected");
    priority_actions.push("Add a Contact page with phone/email/address + simple form");
  }

  if (catMap.mobile.score < 6) {
    red_flags.push("Weak mobile UX signals (viewport/responsive hints missing)");
    priority_actions.push("Ensure responsive mobile layout + add viewport meta + test on phone");
  }

  if (catMap.broken_links.score < 7) {
    red_flags.push("Broken navigation links detected");
    priority_actions.push("Fix top navigation links returning 404/500");
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

  return {
    ekklesiaScore,
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
  };
}
