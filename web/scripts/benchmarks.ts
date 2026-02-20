import { readFileSync } from "node:fs";
import path from "node:path";
import { scoutWebsiteV2 } from "@/lib/scout";
import { auditorFromScoutV2 } from "@/lib/auditor";

type Bucket = "excellent" | "good" | "average" | "poor";

type BenchmarkSite = { url: string; bucket: Bucket; notes: string };

type BenchFile = { version: number; sites: BenchmarkSite[] };

function must<T>(x: T | null | undefined, msg: string): T {
  if (x == null) throw new Error(msg);
  return x;
}

function stripHash(u: string) {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

async function scoreUrl(url: string) {
  const report = await scoutWebsiteV2({ website_url: url }, { maxPages: 6 });
  const score = auditorFromScoutV2(report);
  return { url, score: score.score_0_100 ?? score.ekklesiaScore, confidence: score.confidence_0_100 ?? 0, grade: score.grade };
}

async function main() {
  const filePath = path.join(process.cwd(), "benchmarks", "sites.json");
  const bench = JSON.parse(readFileSync(filePath, "utf8")) as BenchFile;
  const sites = bench.sites.map((s) => ({ ...s, url: stripHash(s.url) }));

  const byBucket = (b: Bucket) => sites.filter((s) => s.bucket === b);

  const results: Record<string, any> = {};

  // Targeted gate (runs even when the full benchmark set is incomplete)
  const ketteringUrl = "https://www.ketteringadventist.org/";
  const abiUrl = "https://abideoh.adventistchurch.org/";

  const hasK = sites.some((s) => s.url === ketteringUrl);
  const hasA = sites.some((s) => s.url === abiUrl);
  if (!hasK || !hasA) {
    throw new Error(`TARGET_GATE_MISSING_URLS: need Kettering + ABI in benchmarks/sites.json`);
  }

  console.log("\nRunning targeted gate: Kettering vs ABI");
  results[ketteringUrl] = results[ketteringUrl] ?? (await scoreUrl(ketteringUrl));
  results[abiUrl] = results[abiUrl] ?? (await scoreUrl(abiUrl));

  const k = results[ketteringUrl];
  const a = results[abiUrl];

  const delta = (k.score ?? 0) - (a.score ?? 0);
  console.log(`Kettering score=${k.score} conf=${k.confidence} grade=${k.grade}`);
  console.log(`ABI score=${a.score} conf=${a.confidence} grade=${a.grade}`);
  console.log(`Delta: ${delta}`);

  if (delta < 15) {
    throw new Error(`TARGET_GATE_FAIL: score(Kettering)-score(ABI)=${delta} < 15`);
  }

  // Grade safety: ABI cannot exceed C unless confidence>=80 (and evidence completeness will enforce essentials in scoring)
  const abiGrade = String(a.grade || "");
  const abiConf = Number(a.confidence ?? 0);
  if ((abiGrade.startsWith("A") || abiGrade.startsWith("B")) && abiConf < 80) {
    throw new Error(`TARGET_GATE_FAIL: ABI grade ${abiGrade} not allowed with confidence ${abiConf} (<80)`);
  }

  // Full benchmark gate (40 sites) — merge blocker for final scoring.
  const req = { excellent: 10, good: 10, average: 10, poor: 10 } as const;
  for (const [b, n] of Object.entries(req) as any) {
    const count = byBucket(b as Bucket).length;
    if (count < n) {
      throw new Error(`BENCHMARK_SET_INCOMPLETE: need ${n} ${b}, have ${count}`);
    }
  }

  for (const s of sites) {
    console.log(`Scoring ${s.bucket}: ${s.url}`);
    results[s.url] = await scoreUrl(s.url);
  }

  const excellent = byBucket("excellent");
  const poor = byBucket("poor");

  let total = 0;
  let wins = 0;
  for (const e of excellent) {
    for (const p of poor) {
      total += 1;
      if (results[e.url].score > results[p.url].score) wins += 1;
    }
  }

  const outrankRate = total ? wins / total : 0;
  console.log(`\nPairwise outrank rate (excellent > poor): ${(outrankRate * 100).toFixed(1)}% (${wins}/${total})`);

  if (outrankRate < 0.9) {
    throw new Error(`BENCHMARK_GATE_FAIL: excellent>poor outrank rate ${(outrankRate * 100).toFixed(1)}% < 90%`);
  }

  console.log("BENCHMARK_GATE_PASS");
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
