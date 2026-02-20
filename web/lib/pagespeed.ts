export type PageSpeedMobileResult = {
  strategy: "mobile";
  final_url: string;
  fetched_at: string;
  lighthouse: {
    performance?: number | null;
    accessibility?: number | null;
    best_practices?: number | null;
    seo?: number | null;
  };
  cwv: {
    lcp_ms?: number | null;
    cls?: number | null;
    inp_ms?: number | null;
  };
  raw?: any;
  error?: string | null;
};

export async function fetchPageSpeedInsightsMobile(url: string): Promise<PageSpeedMobileResult> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const fetched_at = new Date().toISOString();

  if (!apiKey) {
    return {
      strategy: "mobile",
      final_url: url,
      fetched_at,
      lighthouse: {},
      cwv: {},
      raw: null,
      error: "PAGESPEED_API_KEY not set",
    };
  }

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("key", apiKey);
  // Categories
  endpoint.searchParams.append("category", "performance");
  endpoint.searchParams.append("category", "accessibility");
  endpoint.searchParams.append("category", "best-practices");
  endpoint.searchParams.append("category", "seo");

  try {
    const resp = await fetch(endpoint.toString(), { method: "GET" });
    const raw = await resp.json().catch(() => null);
    if (!resp.ok) {
      return {
        strategy: "mobile",
        final_url: url,
        fetched_at,
        lighthouse: {},
        cwv: {},
        raw,
        error: `PSI failed (${resp.status})`,
      };
    }

    const lh = raw?.lighthouseResult ?? null;
    const cats = lh?.categories ?? {};

    const perf = cats?.performance?.score;
    const a11y = cats?.accessibility?.score;
    const bp = cats?.["best-practices"]?.score;
    const seo = cats?.seo?.score;

    const metrics = lh?.audits ?? {};

    // CWV values (best-effort extraction)
    const lcp = metrics?.["largest-contentful-paint"]?.numericValue;
    const cls = metrics?.["cumulative-layout-shift"]?.numericValue;
    const inp = metrics?.["interaction-to-next-paint"]?.numericValue;

    return {
      strategy: "mobile",
      final_url: lh?.finalUrl ?? url,
      fetched_at,
      lighthouse: {
        performance: typeof perf === "number" ? Math.round(perf * 100) : null,
        accessibility: typeof a11y === "number" ? Math.round(a11y * 100) : null,
        best_practices: typeof bp === "number" ? Math.round(bp * 100) : null,
        seo: typeof seo === "number" ? Math.round(seo * 100) : null,
      },
      cwv: {
        lcp_ms: typeof lcp === "number" ? Math.round(lcp) : null,
        cls: typeof cls === "number" ? Number(cls) : null,
        inp_ms: typeof inp === "number" ? Math.round(inp) : null,
      },
      raw,
      error: null,
    };
  } catch (e: any) {
    return {
      strategy: "mobile",
      final_url: url,
      fetched_at,
      lighthouse: {},
      cwv: {},
      raw: null,
      error: e?.message ?? "PSI fetch error",
    };
  }
}
