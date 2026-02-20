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

  // Gate: require full 40-site benchmark set before allowing merges.
  // This makes it impossible to "tune" without ground truth.
  const req = { excellent: 10, good: 10, average: 10, poor: 10 } as const;
  for (const [b, n] of Object.entries(req) as any) {
    const count = byBucket(b as Bucket).length;
    if (count < n) {
      throw new Error(`BENCHMARK_SET_INCOMPLETE: need ${n} ${b}, have ${count}`);
    }
  }

  const results: Record<string, any> = {};
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
