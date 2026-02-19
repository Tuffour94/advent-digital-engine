import type { ScoutSignals } from "@/lib/scout";

export type AuditorScore = {
  ekklesiaScore: number;
  grade: string;
  strengths: string[];
  red_flags: string[];
  priority_actions: string[];
  components: Record<string, number>;
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

export function auditorFromScout(s: ScoutSignals): AuditorScore {
  // Deterministic v1 scoring (0 token burn)
  // Weighting: 100 total
  const components: Record<string, number> = {};

  // Mission clarity (0-20)
  const missionSignals = [s.h1, s.meta_description, s.title].filter(Boolean).join(" ").toLowerCase();
  const hasMissionWords = /(mission|welcome|about|who we are|our church|adventist|sda|seventh-day)/.test(missionSignals);
  components.mission_clarity = hasMissionWords ? 18 : 6;

  // Events (0-15)
  components.events = s.has_events ? 12 : 3;

  // Giving (0-15)
  components.giving = s.has_giving ? 15 : 2;

  // Sermon / media / livestream (0-15)
  components.media = s.has_livestream ? 12 : 4;

  // Contact clarity (0-15)
  components.contact = s.has_contact ? 15 : 2;

  // Mobile friendliness signal (0-10)
  components.mobile = s.has_viewport_meta ? 10 : 2;

  // Broken links hint (0-10) (lower is better)
  const brokenPenalty = clamp(s.broken_link_hint_count, 0, 10);
  components.broken_links = clamp(10 - brokenPenalty, 0, 10);

  const total = Object.values(components).reduce((a, b) => a + b, 0);
  const ekklesiaScore = clamp(Math.round(total), 0, 100);

  const strengths: string[] = [];
  const red_flags: string[] = [];
  const priority_actions: string[] = [];

  if (components.mission_clarity >= 15) strengths.push("Clear mission/identity signals on homepage");
  else priority_actions.push("Add a clear mission statement + ‘Who we are’ summary above the fold");

  if (s.has_about_or_beliefs) strengths.push("About/Beliefs link present");
  else priority_actions.push("Add an About/Beliefs page link in main navigation");

  if (s.has_events) strengths.push("Events/Calendar signals present");
  else priority_actions.push("Add Events/Calendar page (and keep it updated)");

  if (s.has_giving) strengths.push("Online giving/donation path detected");
  else {
    red_flags.push("No online giving link detected");
    priority_actions.push("Add an online giving link (Give/Donate) in main navigation");
  }

  if (s.has_contact) strengths.push("Contact information detected (email/phone/contact page)");
  else {
    red_flags.push("No clear contact path detected");
    priority_actions.push("Add a Contact page with phone/email/address and a simple contact form");
  }

  if (s.has_viewport_meta) strengths.push("Mobile-friendly viewport meta present");
  else {
    red_flags.push("Missing viewport meta (mobile friendliness signal)");
    priority_actions.push("Add responsive viewport meta tag and verify mobile layout");
  }

  if (s.broken_link_hint_count >= 3) {
    red_flags.push("Potential broken/placeholder links detected (# / javascript links)");
    priority_actions.push("Fix placeholder links and remove dead CTAs");
  }

  return {
    ekklesiaScore,
    grade: gradeFor(ekklesiaScore),
    strengths: strengths.slice(0, 8),
    red_flags: red_flags.slice(0, 8),
    priority_actions: priority_actions.slice(0, 10),
    components,
  };
}
