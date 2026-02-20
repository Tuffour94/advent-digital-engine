import * as cheerio from "cheerio";

export type ScoutInputs = {
  website_url: string;
  youtube_url?: string | null;
  facebook_url?: string | null;
};

export type EvidenceItem = {
  check_id: string;
  url: string;
  status: number | null;
  found: boolean;
  snippet?: string | null;
  details?: Record<string, any>;
};

export type ScoutPage = {
  url: string;
  final_url: string;
  status: number;
  fetch_ms: number;
  html_length: number;
  text_length: number;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  h2_count: number;
  img_count: number;
  img_alt_count: number;
  has_viewport_meta: boolean;
  nav_links: string[];
  link_count: number;
  broken_link_hint_count: number;
  text_excerpt: string | null;
  has_https: boolean;
};

export type ScoutReport = {
  inputs: ScoutInputs;
  fetched_at: string;
  pages_checked: ScoutPage[];
  evidence: EvidenceItem[];
  signals: {
    domain: string;

    // crawl metrics (for confidence)
    crawl_target_pages: number;
    attempted_fetches: number;
    successful_fetches: number;
    same_origin_pages: number;

    // render visibility
    render_required: boolean;

    // presence
    has_livestream: boolean;
    has_events: boolean;
    has_contact: boolean;
    has_giving: boolean;
    has_about_or_beliefs: boolean;
    has_service_times: boolean;
    has_sermons_messages: boolean;
    has_responsive_css_hint: boolean;

    // enforcement detectors
    has_leadership_info: boolean;
    has_physical_address: boolean;
    sitemap_status: number | null;
    has_sitemap: boolean;
    sitemap_parsed_url_count: number;
    has_homepage_cta: boolean;
    events_recent_90d: boolean;
    sermons_recent_6mo: boolean;
    copyright_fresh: boolean;

    nav_sample_checked: number;
    broken_nav_links: { url: string; status: number | null }[];
  };
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function safeText(s?: string | null) {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

function toAbs(baseUrl: string, href: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function extractEmails(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return uniq(matches);
}

function extractPhones(text: string) {
  const matches = text.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [];
  return uniq(matches);
}

function findSnippet(text: string, re: RegExp, maxLen = 160) {
  const m = text.match(re);
  if (!m?.index && m?.index !== 0) return null;
  const start = Math.max(0, m.index - Math.floor(maxLen / 2));
  const chunk = text.slice(start, start + maxLen);
  return safeText(chunk);
}

function extractDateCandidates(text: string) {
  // Very lightweight date extraction for deterministic recency checks.
  const candidates: string[] = [];

  // e.g., Feb 18, 2026
  const monthName = /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}/gi;
  for (const m of text.match(monthName) ?? []) candidates.push(m);

  // e.g., 02/18/2026 or 2/18/26
  const numeric = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
  for (const m of text.match(numeric) ?? []) candidates.push(m);

  // e.g., 2026-02-18
  const iso = /\b\d{4}-\d{2}-\d{2}\b/g;
  for (const m of text.match(iso) ?? []) candidates.push(m);

  return uniq(candidates).slice(0, 25);
}

function parseBestDate(text: string) {
  // Pick the most recent parseable date found.
  const candidates = extractDateCandidates(text);
  let best: Date | null = null;
  let bestRaw: string | null = null;

  for (const raw of candidates) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    if (!best || d.getTime() > best.getTime()) {
      best = d;
      bestRaw = raw;
    }
  }

  return { date: best, raw: bestRaw };
}

function looksLikePhysicalAddress(text: string) {
  // Simple US-centric heuristic.
  const re = /\b\d{1,6}\s+[A-Za-z0-9.#\-\s]{3,}\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court)\b/i;
  return re.test(text);
}

function detectOnPage(pageUrl: string, html: string) {
  const $ = cheerio.load(html);

  const title = safeText($("title").first().text());
  const meta_description = safeText($("meta[name='description']").attr("content") ?? null);
  const h1 = safeText($("h1").first().text());
  const has_viewport_meta = Boolean($("meta[name='viewport']").attr("content"));

  const navLinks: string[] = [];
  $("nav a[href]").each((_i, el) => {
    const href = String($(el).attr("href") || "");
    const abs = toAbs(pageUrl, href);
    if (abs) navLinks.push(abs);
  });
  if (navLinks.length === 0) {
    $("header a[href]").each((_i, el) => {
      const href = String($(el).attr("href") || "");
      const abs = toAbs(pageUrl, href);
      if (abs) navLinks.push(abs);
    });
  }

  const allLinks: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = String($(el).attr("href") || "");
    const abs = toAbs(pageUrl, href);
    if (abs) allLinks.push(abs);
  });

  const textBlobRaw = $("body").text();
  const textBlob = safeText(textBlobRaw) ?? "";

  const broken_link_hint_count = $("a[href^='#']").length + $("a[href^='javascript']").length + $("a[href='']").length;

  const excerpt = safeText(textBlob.slice(0, 600));

  const h2_count = $("h2").length;
  const img_count = $("img").length;
  const img_alt_count = $("img[alt]").filter((_i, el) => String($(el).attr("alt") || "").trim().length > 0).length;

  return {
    $,
    title,
    meta_description,
    h1,
    h2_count,
    img_count,
    img_alt_count,
    has_viewport_meta,
    nav_links: uniq(navLinks).slice(0, 50),
    link_count: uniq(allLinks).length,
    broken_link_hint_count,
    textBlob,
    emails: extractEmails(textBlobRaw).slice(0, 10),
    phones: extractPhones(textBlobRaw).slice(0, 10),
    text_excerpt: excerpt,
  };
}

async function fetchHtml(url: string) {
  const t0 = Date.now();
  const resp = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "ADE Scout v2 (+https://advent-digital-engine.vercel.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await resp.text();
  const fetch_ms = Date.now() - t0;
  return { status: resp.status, final_url: resp.url || url, html, fetch_ms };
}

async function headOrGet(url: string) {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    return head.status;
  } catch {
    try {
      const get = await fetch(url, { method: "GET", redirect: "follow" });
      return get.status;
    } catch {
      return null;
    }
  }
}

async function getStatus(url: string) {
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow" });
    return r.status;
  } catch {
    return null;
  }
}

export async function scoutWebsiteV2(inputs: ScoutInputs, opts?: { maxPages?: number }): Promise<ScoutReport> {
  const startUrl = inputs.website_url;
  const fetched_at = new Date().toISOString();

  const homepage = await fetchHtml(startUrl);
  const homeDetected = detectOnPage(homepage.final_url, homepage.html);

  const origin = new URL(homepage.final_url).origin;

  // Candidate internal pages (deterministic)
  const candidates = [
    "/about",
    "/about-us",
    "/beliefs",
    "/what-we-believe",
    "/contact",
    "/contact-us",
    "/events",
    "/calendar",
    "/give",
    "/giving",
    "/donate",
    "/watch",
    "/sermons",
    "/messages",
  ].map((p) => origin + p);

  // Prefer nav links that look like key pages.
  const nav = homeDetected.nav_links.filter((u) => sameOrigin(u, origin));
  const prioritizedNav = nav.filter((u) => /(about|belief|contact|give|donat|event|calendar|watch|sermon|message|live)/i.test(u));

  const maxPages = opts?.maxPages ?? 6;
  const toFetch = uniq([homepage.final_url, ...prioritizedNav, ...candidates]).filter((u) => sameOrigin(u, origin)).slice(0, maxPages);

  const pages: ScoutPage[] = [];
  const evidence: EvidenceItem[] = [];

  // Fetch pages (serial for simplicity/determinism)
  for (const u of toFetch) {
    const r = await fetchHtml(u);
    const d = detectOnPage(r.final_url, r.html);
    const has_https = (() => {
      try {
        return new URL(r.final_url).protocol === "https:";
      } catch {
        return false;
      }
    })();

    pages.push({
      url: u,
      final_url: r.final_url,
      status: r.status,
      fetch_ms: r.fetch_ms,
      html_length: r.html.length,
      text_length: d.textBlob.length,
      title: d.title,
      meta_description: d.meta_description,
      h1: d.h1,
      h2_count: d.h2_count,
      img_count: d.img_count,
      img_alt_count: d.img_alt_count,
      has_viewport_meta: d.has_viewport_meta,
      nav_links: d.nav_links,
      link_count: d.link_count,
      broken_link_hint_count: d.broken_link_hint_count,
      text_excerpt: d.text_excerpt,
      has_https,
    });

    // Evidence checks per page (patterns + snippets)
    const text = d.textBlob;
    const urlLower = r.final_url.toLowerCase();

    const checks: Array<{ id: string; re: RegExp; label: string }> = [
      { id: "giving.keyword", re: /\b(give|giving|donate|stewardship|tithe)\b/i, label: "Giving keyword" },
      { id: "events.keyword", re: /\b(events?|calendar|upcoming)\b/i, label: "Events keyword" },
      { id: "media.keyword", re: /\b(sermons?|messages?|watch|livestream|live stream)\b/i, label: "Media keyword" },
      { id: "contact.keyword", re: /\b(contact|phone|email|address)\b/i, label: "Contact keyword" },
      { id: "service_times.keyword", re: /\b(service times?|worship\s+times?|sabbath\s+school)\b/i, label: "Service times" },
      { id: "mission.keyword", re: /\b(mission|welcome|who we are|our church)\b/i, label: "Mission clarity" },
      { id: "adventist.keyword", re: /\b(adventist|sda|seventh-day)\b/i, label: "Adventist identity" },
    ];

    for (const c of checks) {
      const found = c.re.test(text);
      evidence.push({
        check_id: c.id,
        url: r.final_url,
        status: r.status,
        found,
        snippet: found ? findSnippet(text, c.re) : null,
        details: { label: c.label },
      });
    }

    // Giving providers
    const providerPatterns: Array<{ id: string; re: RegExp }> = [
      { id: "giving.tithely", re: /tithe\.ly/i },
      { id: "giving.pushpay", re: /pushpay/i },
      { id: "giving.subsplash", re: /subsplash/i },
      { id: "giving.adventistgiving", re: /adventistgiving/i },
    ];
    for (const p of providerPatterns) {
      const found = p.re.test(r.html);
      evidence.push({
        check_id: p.id,
        url: r.final_url,
        status: r.status,
        found,
        snippet: found ? p.id : null,
      });
    }

    // YouTube embed
    const ytFound = /youtube\.com\/embed|youtu\.be|youtube\.com\/watch/i.test(r.html);
    evidence.push({ check_id: "media.youtube_embed", url: r.final_url, status: r.status, found: ytFound, snippet: ytFound ? "YouTube embed/link detected" : null });

    // Responsive hint (very light): media queries
    const cssHint = /@media\s*\(/i.test(r.html) || /viewport/i.test(r.html);
    evidence.push({ check_id: "mobile.responsive_hint", url: r.final_url, status: r.status, found: cssHint, snippet: cssHint ? "Responsive hint detected" : null });

    // Page-type hints by URL
    if (/\/(about|belief)/i.test(urlLower)) evidence.push({ check_id: "page.about", url: r.final_url, status: r.status, found: true });
    if (/\/(contact)/i.test(urlLower)) evidence.push({ check_id: "page.contact", url: r.final_url, status: r.status, found: true });
    if (/\/(give|giving|donate)/i.test(urlLower)) evidence.push({ check_id: "page.giving", url: r.final_url, status: r.status, found: true });
    if (/\/(events|calendar)/i.test(urlLower)) evidence.push({ check_id: "page.events", url: r.final_url, status: r.status, found: true });
    if (/\/(sermons|messages|watch|live)/i.test(urlLower)) evidence.push({ check_id: "page.media", url: r.final_url, status: r.status, found: true });
  }

  // Sitemap check (status + parseable url count sample)
  const sitemapUrl = origin.replace(/\/$/, "") + "/sitemap.xml";
  let sitemap_status = await getStatus(sitemapUrl);
  let sitemap_parsed_url_count = 0;
  if (sitemap_status && sitemap_status < 400) {
    try {
      const resp = await fetch(sitemapUrl, { method: "GET" });
      sitemap_status = resp.status;
      const xml = await resp.text().catch(() => "");
      // very light deterministic parse: count <loc> tags
      const locs = xml.match(/<loc>[^<]+<\/loc>/gi) ?? [];
      sitemap_parsed_url_count = Math.min(locs.length, 5000);
    } catch {
      // ignore
    }
  }
  const has_sitemap = Boolean(sitemap_status && sitemap_status < 400);
  evidence.push({
    check_id: "trust.sitemap",
    url: sitemapUrl,
    status: sitemap_status,
    found: has_sitemap,
    snippet: has_sitemap ? `sitemap.xml returned ${sitemap_status}` : `sitemap.xml missing (${sitemap_status ?? "no response"})`,
    details: { parsed_url_count: sitemap_parsed_url_count },
  });

  // Nav broken link sampling from homepage nav links
  const sampleNav = uniq(homeDetected.nav_links).filter((u) => sameOrigin(u, origin)).slice(0, 8);
  const broken_nav_links: { url: string; status: number | null }[] = [];
  const nav_checked: Array<{ url: string; status: number | null }> = [];
  for (const u of sampleNav) {
    const st = await headOrGet(u);
    nav_checked.push({ url: u, status: st ?? null });
    if (st && st >= 400) broken_nav_links.push({ url: u, status: st });
  }
  evidence.push({
    check_id: "maintenance.broken_nav_sample",
    url: homepage.final_url,
    status: homepage.status,
    found: true,
    snippet: `Checked ${nav_checked.length} nav links; failures: ${broken_nav_links.length}`,
    details: { checked: nav_checked, failures: broken_nav_links },
  });

  // Aggregate signals across evidence
  const has = (id: string) => evidence.some((e) => e.check_id === id && e.found);
  const hasAny = (prefix: string) => evidence.some((e) => e.check_id.startsWith(prefix) && e.found);

  const combinedText = pages.map((p) => p.text_excerpt ?? "").join(" \n ");

  // Enforcement detectors
  const has_leadership_info = /\b(pastor|pastors|leadership|elder|elders|staff|our team)\b/i.test(combinedText);
  evidence.push({
    check_id: "trust.leadership_info",
    url: homepage.final_url,
    status: homepage.status,
    found: has_leadership_info,
    snippet: has_leadership_info ? findSnippet(combinedText, /\b(pastor|leadership|elder|staff|our team)\b/i) : null,
  });

  const has_physical_address = looksLikePhysicalAddress(combinedText) || /\b(map|directions)\b/i.test(combinedText);
  evidence.push({
    check_id: "trust.physical_address",
    url: homepage.final_url,
    status: homepage.status,
    found: has_physical_address,
    snippet: has_physical_address ? findSnippet(combinedText, /\b\d{1,6}\s+.*\b(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court)\b/i) : null,
  });

  const mapLinkFound = /(google\.com\/maps|apple\.com\/maps|\/maps\b|\bdirections\b)/i.test(combinedText);
  evidence.push({
    check_id: "trust.map_directions",
    url: homepage.final_url,
    status: homepage.status,
    found: mapLinkFound,
    snippet: mapLinkFound ? findSnippet(combinedText, /(google\.com\/maps|apple\.com\/maps|directions)/i) : null,
  });

  const has_homepage_cta = /(plan\s+a\s+visit|visit\s+us|i'?m\s+new|new\s+here|watch\s+live|join\s+us|get\s+involved|contact\s+us|give\s+now)/i.test(pages[0]?.text_excerpt ?? "");
  evidence.push({
    check_id: "ux.homepage_cta",
    url: homepage.final_url,
    status: homepage.status,
    found: has_homepage_cta,
    snippet: has_homepage_cta ? findSnippet(pages[0]?.text_excerpt ?? "", /(plan\s+a\s+visit|new\s+here|watch\s+live|join\s+us|give\s+now)/i) : null,
  });

  const hasViewport = Boolean(pages[0]?.has_viewport_meta);
  evidence.push({
    check_id: "mobile.viewport",
    url: homepage.final_url,
    status: homepage.status,
    found: hasViewport,
    snippet: hasViewport ? "meta viewport detected" : "meta viewport missing",
  });

  // Recency checks (best-effort on combined text)
  const { date: eventDate, raw: eventRaw } = parseBestDate(combinedText);
  const now = new Date();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const events_recent_90d = Boolean(eventDate && Math.abs(now.getTime() - eventDate.getTime()) <= ninetyDaysMs);
  const eventsDays = eventDate ? Math.round(Math.abs(now.getTime() - eventDate.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const noUpcomingEventsStatement = /no\s+upcoming\s+events|no\s+events\s+scheduled|check\s+back\s+soon\s+for\s+events/i.test(combinedText);
  evidence.push({
    check_id: "freshness.events_90d",
    url: homepage.final_url,
    status: homepage.status,
    found: events_recent_90d,
    snippet: eventRaw ? `Best date found: ${eventRaw}` : noUpcomingEventsStatement ? "Explicit statement: no upcoming events" : null,
    details: { best_date: eventRaw, best_date_iso: eventDate ? eventDate.toISOString() : null, days_since: eventsDays, explicit_none: noUpcomingEventsStatement },
  });

  const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
  const sermons_recent_6mo = Boolean(
    eventDate && Math.abs(now.getTime() - eventDate.getTime()) <= sixMonthsMs && (has("media.youtube_embed") || has("page.media") || has("media.keyword"))
  );
  const sermonsDays = eventDate ? Math.round(Math.abs(now.getTime() - eventDate.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const noArchiveStatement = /no\s+sermons|no\s+messages|no\s+archive|sermons\s+coming\s+soon/i.test(combinedText);
  evidence.push({
    check_id: "freshness.sermons_6mo",
    url: homepage.final_url,
    status: homepage.status,
    found: sermons_recent_6mo,
    snippet: eventRaw ? `Best date found: ${eventRaw}` : noArchiveStatement ? "Explicit statement: no archive" : null,
    details: { best_date: eventRaw, best_date_iso: eventDate ? eventDate.toISOString() : null, days_since: sermonsDays, explicit_none: noArchiveStatement },
  });

  // Copyright freshness
  const year = new Date().getFullYear();
  const copyright_fresh = new RegExp(`(©|copyright)\\s*(${year}|${year - 1})`, "i").test(combinedText);
  evidence.push({
    check_id: "maintenance.copyright_fresh",
    url: homepage.final_url,
    status: homepage.status,
    found: copyright_fresh,
    snippet: copyright_fresh ? findSnippet(combinedText, /(©|copyright)\s*\d{4}/i) : null,
  });

  // Crawl metrics (for confidence)
  const crawl_target_pages = pages.length;
  const attempted_fetches = toFetch.length;
  const successful_fetches = pages.filter((p) => (p.status ?? 0) > 0 && p.status < 400).length;
  const same_origin_pages = pages.filter((p) => sameOrigin(p.final_url, origin)).length;

  // Render visibility heuristic (free, deterministic)
  const home = pages[0];
  const render_required = Boolean(
    home &&
      home.html_length > 2000 &&
      home.text_length < 250 &&
      (/id=\"__next\"/i.test(home.text_excerpt ?? "") || true)
  );

  const report: ScoutReport = {
    inputs,
    fetched_at,
    pages_checked: pages,
    evidence,
    signals: {
      domain: origin,

      crawl_target_pages,
      attempted_fetches,
      successful_fetches,
      same_origin_pages,
      render_required,

      has_livestream: has("media.keyword") || has("page.media") || has("media.youtube_embed"),
      has_events: has("events.keyword") || has("page.events"),
      has_contact: has("contact.keyword") || has("page.contact") || hasAny("contact."),
      has_giving: has("giving.keyword") || has("page.giving") || hasAny("giving."),
      has_about_or_beliefs: has("page.about") || has("mission.keyword") || has("adventist.keyword"),
      has_service_times: has("service_times.keyword"),
      has_sermons_messages: has("media.youtube_embed") || /\/(sermons|messages|watch)/i.test(origin),
      has_responsive_css_hint: has("mobile.responsive_hint"),

      has_leadership_info,
      has_physical_address,
      sitemap_status,
      has_sitemap,
      sitemap_parsed_url_count,
      has_homepage_cta,
      events_recent_90d,
      sermons_recent_6mo,
      copyright_fresh,

      nav_sample_checked: sampleNav.length,
      broken_nav_links,
    },
  };

  return report;
}
