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
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  has_viewport_meta: boolean;
  nav_links: string[];
  link_count: number;
  broken_link_hint_count: number;
  text_excerpt: string | null;
};

export type ScoutReport = {
  inputs: ScoutInputs;
  fetched_at: string;
  pages_checked: ScoutPage[];
  evidence: EvidenceItem[];
  signals: {
    domain: string;
    has_livestream: boolean;
    has_events: boolean;
    has_contact: boolean;
    has_giving: boolean;
    has_about_or_beliefs: boolean;
    has_service_times: boolean;
    has_sermons_messages: boolean;
    has_responsive_css_hint: boolean;
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

  return {
    $,
    title,
    meta_description,
    h1,
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
  const resp = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "ADE Scout v2 (+https://advent-digital-engine.vercel.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await resp.text();
  return { status: resp.status, final_url: resp.url || url, html };
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

export async function scoutWebsiteV2(inputs: ScoutInputs): Promise<ScoutReport> {
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

  const toFetch = uniq([homepage.final_url, ...prioritizedNav, ...candidates]).filter((u) => sameOrigin(u, origin)).slice(0, 6);

  const pages: ScoutPage[] = [];
  const evidence: EvidenceItem[] = [];

  // Fetch pages (serial for simplicity/determinism)
  for (const u of toFetch) {
    const r = await fetchHtml(u);
    const d = detectOnPage(r.final_url, r.html);
    pages.push({
      url: u,
      final_url: r.final_url,
      status: r.status,
      title: d.title,
      meta_description: d.meta_description,
      h1: d.h1,
      has_viewport_meta: d.has_viewport_meta,
      nav_links: d.nav_links,
      link_count: d.link_count,
      broken_link_hint_count: d.broken_link_hint_count,
      text_excerpt: d.text_excerpt,
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

  // Nav broken link sampling from homepage nav links
  const sampleNav = uniq(homeDetected.nav_links).filter((u) => sameOrigin(u, origin)).slice(0, 8);
  const broken_nav_links: { url: string; status: number | null }[] = [];
  for (const u of sampleNav) {
    const st = await headOrGet(u);
    if (st && st >= 400) broken_nav_links.push({ url: u, status: st });
  }

  // Aggregate signals across evidence
  const has = (id: string) => evidence.some((e) => e.check_id === id && e.found);
  const hasAny = (prefix: string) => evidence.some((e) => e.check_id.startsWith(prefix) && e.found);

  const report: ScoutReport = {
    inputs,
    fetched_at,
    pages_checked: pages,
    evidence,
    signals: {
      domain: origin,
      has_livestream: has("media.keyword") || has("page.media") || has("media.youtube_embed"),
      has_events: has("events.keyword") || has("page.events"),
      has_contact: has("contact.keyword") || has("page.contact") || hasAny("contact."),
      has_giving: has("giving.keyword") || has("page.giving") || hasAny("giving."),
      has_about_or_beliefs: has("page.about") || has("mission.keyword") || has("adventist.keyword"),
      has_service_times: has("service_times.keyword"),
      has_sermons_messages: has("media.youtube_embed") || /\/(sermons|messages|watch)/i.test(origin),
      has_responsive_css_hint: has("mobile.responsive_hint"),
      broken_nav_links,
    },
  };

  return report;
}
