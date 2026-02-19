import * as cheerio from "cheerio";

export type ScoutInputs = {
  website_url: string;
  youtube_url?: string | null;
  facebook_url?: string | null;
};

export type ScoutSignals = {
  final_url: string;
  status: number;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  has_viewport_meta: boolean;
  nav_links: string[];
  link_count: number;
  broken_link_hint_count: number;
  has_livestream: boolean;
  has_events: boolean;
  has_contact: boolean;
  has_giving: boolean;
  has_about_or_beliefs: boolean;
  emails: string[];
  phones: string[];
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

function extractEmails(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return uniq(matches);
}

function extractPhones(text: string) {
  // loose US-centric pattern; good enough for v1 signal
  const matches = text.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [];
  return uniq(matches);
}

function hasAnyLink($: cheerio.CheerioAPI, baseUrl: string, predicate: (abs: string, text: string) => boolean) {
  let found = false;
  $("a[href]").each((_i, el) => {
    if (found) return;
    const href = String($(el).attr("href") || "");
    const abs = toAbs(baseUrl, href);
    const text = safeText($(el).text()) ?? "";
    if (!abs) return;
    if (predicate(abs.toLowerCase(), text.toLowerCase())) found = true;
  });
  return found;
}

export async function scoutWebsite(websiteUrl: string) {
  const resp = await fetch(websiteUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "ADE Scout v1 (+https://advent-digital-engine.vercel.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  const html = await resp.text();
  const finalUrl = resp.url || websiteUrl;

  const $ = cheerio.load(html);

  const title = safeText($("title").first().text());
  const meta_description = safeText($("meta[name='description']").attr("content") ?? null);
  const h1 = safeText($("h1").first().text());
  const has_viewport_meta = Boolean($("meta[name='viewport']").attr("content"));

  // nav links (best-effort)
  const navLinks: string[] = [];
  $("nav a[href]").each((_i, el) => {
    const href = String($(el).attr("href") || "");
    const abs = toAbs(finalUrl, href);
    if (abs) navLinks.push(abs);
  });

  // If no <nav>, fall back to header links
  if (navLinks.length === 0) {
    $("header a[href]").each((_i, el) => {
      const href = String($(el).attr("href") || "");
      const abs = toAbs(finalUrl, href);
      if (abs) navLinks.push(abs);
    });
  }

  const allLinks: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = String($(el).attr("href") || "");
    const abs = toAbs(finalUrl, href);
    if (abs) allLinks.push(abs);
  });

  const textBlob = $("body").text();
  const emails = extractEmails(textBlob);
  const phones = extractPhones(textBlob);

  const broken_link_hint_count = (
    $("a[href^='#']").length +
    $("a[href^='javascript']").length +
    $("a[href='']").length
  );

  const has_livestream =
    hasAnyLink($, finalUrl, (abs, text) => abs.includes("/live") || abs.includes("youtube.com/live") || text.includes("live")) ||
    /\blive\b/i.test(textBlob);

  const has_events =
    hasAnyLink($, finalUrl, (abs, text) => abs.includes("event") || abs.includes("calendar") || text.includes("event")) ||
    /\bevents?\b/i.test(textBlob);

  const has_giving = hasAnyLink($, finalUrl, (abs, text) => abs.includes("give") || abs.includes("donate") || text.includes("give"));
  const has_contact =
    emails.length > 0 ||
    phones.length > 0 ||
    hasAnyLink($, finalUrl, (abs, text) => abs.includes("contact") || text.includes("contact"));

  const has_about_or_beliefs = hasAnyLink($, finalUrl, (abs, text) => {
    return (
      abs.includes("about") ||
      abs.includes("belief") ||
      abs.includes("what-we-believe") ||
      text.includes("about") ||
      text.includes("belief")
    );
  });

  const report: ScoutSignals = {
    final_url: finalUrl,
    status: resp.status,
    title,
    meta_description,
    h1,
    has_viewport_meta,
    nav_links: uniq(navLinks).slice(0, 50),
    link_count: uniq(allLinks).length,
    broken_link_hint_count,
    has_livestream,
    has_events,
    has_contact,
    has_giving,
    has_about_or_beliefs,
    emails: emails.slice(0, 10),
    phones: phones.slice(0, 10),
  };

  return { html_length: html.length, signals: report };
}
