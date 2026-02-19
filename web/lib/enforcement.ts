import type { EvidenceItem, ScoutReport } from "@/lib/scout";

export type CapRule = {
  rule_id: string;
  cap_max: number;
  title: string;
  evidence_check_ids: string[];
  evidence_urls: string[];
};

export type PenaltyRule = {
  rule_id: string;
  points: number; // negative
  title: string;
  evidence_check_ids: string[];
  evidence_urls: string[];
};

export type ConfidenceFlags = {
  needs_deeper_crawl: boolean;
  low_confidence_score: boolean;
  missing_coverage_ratio: number; // 0..1
};

export function findEvidence(report: ScoutReport, checkId: string) {
  return report.evidence.filter((e) => e.check_id === checkId);
}

export function hasEvidence(report: ScoutReport, checkId: string) {
  return report.evidence.some((e) => e.check_id === checkId && e.found);
}

export function evidenceUrls(items: EvidenceItem[]) {
  return Array.from(new Set(items.map((e) => e.url).filter(Boolean)));
}

export function computeConfidence(report: ScoutReport): ConfidenceFlags {
  const pages = report.pages_checked ?? [];
  const target = (report as any)?._runtime?.crawl_target ?? 6;
  const missing_coverage_ratio = Math.max(0, 1 - pages.length / Math.max(1, target));

  const low_confidence_score = pages.length < 3 || missing_coverage_ratio > 0.4;
  const needs_deeper_crawl = low_confidence_score || (report.signals?.broken_nav_links?.length ?? 0) >= 2;

  return { needs_deeper_crawl, low_confidence_score, missing_coverage_ratio: Number(missing_coverage_ratio.toFixed(2)) };
}
