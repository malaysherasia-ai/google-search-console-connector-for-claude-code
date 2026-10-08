// Demo mode: realistic synthetic Search Console data so the dashboard can be
// tried (and screenshotted) without a Google account. Never touches Google.
import type { SearchAnalyticsRequest, SearchAnalyticsRow, Site } from "./gsc.js";

export const DEMO_SITES: Site[] = [
  { siteUrl: "sc-domain:northshore-plumbing.com", permissionLevel: "siteOwner" },
  { siteUrl: "https://www.harborhvac.com/", permissionLevel: "siteFullUser" },
];

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const QUERIES = [
  "emergency plumber near me", "plumber near me", "24 hour plumber", "water heater repair", "tankless water heater installation",
  "clogged drain cleaning", "sewer line repair cost", "leak detection service", "burst pipe repair", "toilet repair near me",
  "garbage disposal installation", "sump pump replacement", "water softener installation", "gas line plumber", "repipe house cost",
  "slab leak repair", "hydro jetting cost", "how to unclog a shower drain", "why is my water heater making noise", "low water pressure in house",
  "frozen pipes what to do", "plumber cost per hour", "best plumber north shore", "northshore plumbing reviews", "northshore plumbing",
  "drain camera inspection", "backflow testing", "kitchen sink installation", "bathroom remodel plumbing", "water line replacement",
  "trenchless sewer repair", "running toilet fix", "how long do water heaters last", "water heater flush", "rheem water heater repair",
  "commercial plumber", "licensed plumber evanston", "plumber wilmette", "plumber skokie", "plumber glenview", "plumber highland park",
  "basement flooding cleanup", "sewer smell in basement", "pipe insulation", "pex vs copper", "shower valve replacement",
  "outdoor faucet repair", "well pump repair", "water filtration system", "sink faucet leaking",
];
const PAGES = [
  "/", "/emergency-plumbing/", "/water-heaters/", "/water-heaters/tankless/", "/drain-cleaning/", "/sewer-line-repair/",
  "/leak-detection/", "/service-areas/evanston/", "/service-areas/wilmette/", "/service-areas/skokie/", "/service-areas/glenview/",
  "/blog/unclog-shower-drain/", "/blog/water-heater-noises/", "/blog/low-water-pressure/", "/blog/frozen-pipes/", "/blog/pex-vs-copper/",
  "/blog/how-long-water-heaters-last/", "/pricing/", "/reviews/", "/contact/", "/about/", "/sump-pumps/", "/water-softeners/",
  "/gas-line-services/", "/repiping/", "/backflow-testing/", "/commercial-plumbing/", "/bathroom-plumbing/", "/kitchen-plumbing/",
];
const COUNTRIES: Array<[string, number]> = [["usa", 0.86], ["can", 0.05], ["gbr", 0.02], ["ind", 0.02], ["aus", 0.01], ["phl", 0.01], ["deu", 0.01], ["mex", 0.01], ["zzz", 0.01]];
const DEVICES: Array<[string, number]> = [["MOBILE", 0.64], ["DESKTOP", 0.32], ["TABLET", 0.04]];

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function daily(date: string, site: string) {
  const t = parse(date);
  const r = rng(site + date);
  const daysAgo = (Date.now() - t) / DAY;
  const growth = 1 + Math.max(0, 480 - daysAgo) / 480 * 0.9; // steady growth over 16 months
  const dow = new Date(t).getUTCDay();
  const weekday = dow === 0 || dow === 6 ? 0.72 : 1.06;
  const base = site.includes("harbor") ? 55 : 140;
  const impressions = Math.round(base * 34 * growth * weekday * (0.85 + r() * 0.3));
  const ctr = 0.034 + growth * 0.006 + (r() - 0.5) * 0.006;
  const clicks = Math.round(impressions * ctr);
  const position = Math.max(1, 14.5 - growth * 3.2 + (r() - 0.5) * 1.4);
  return { clicks, impressions, ctr: clicks / impressions, position };
}

function datesIn(req: SearchAnalyticsRequest) {
  const out: string[] = [];
  for (let t = parse(req.startDate); t <= parse(req.endDate); t += DAY) out.push(iso(t));
  return out;
}

function totals(req: SearchAnalyticsRequest, site: string) {
  let clicks = 0;
  let impressions = 0;
  let posW = 0;
  for (const d of datesIn(req)) {
    const v = daily(d, site);
    clicks += v.clicks;
    impressions += v.impressions;
    posW += v.position * v.impressions;
  }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posW / impressions : 0 };
}

function distribute(keys: string[], total: ReturnType<typeof totals>, seed: string, opts: { head: number; posBase: number }) {
  const r = rng(seed);
  const weights = keys.map((_, i) => 1 / Math.pow(i + 1, opts.head) * (0.6 + r() * 0.8));
  const sumW = weights.reduce((a, b) => a + b, 0);
  return keys.map((k, i) => {
    const share = weights[i] / sumW;
    const impressions = Math.max(1, Math.round(total.impressions * share * 0.82));
    const position = Math.max(1, Math.min(48, opts.posBase + i * 0.35 + (r() - 0.45) * 9));
    const expected = position < 2 ? 0.25 : position < 4 ? 0.12 : position < 11 ? 0.04 : 0.006;
    const ctr = expected * (0.35 + r() * 1.1);
    const clicks = Math.round(impressions * ctr);
    return { keys: [k], clicks, impressions, ctr: clicks / impressions, position };
  });
}

// Hourly rows look like Google's: "2026-10-07T13:00:00-07:00" (Pacific time).
function hours(req: SearchAnalyticsRequest, site: string) {
  const out: SearchAnalyticsRow[] = [];
  const nowPT = Date.now() - 7 * 3_600_000;
  const lastHour = Math.floor(nowPT / 3_600_000) - 2; // Google lags a couple of hours
  for (const d of datesIn(req)) {
    const day = daily(d, site);
    for (let h = 0; h < 24; h++) {
      const t = parse(d) + h * 3_600_000;
      if (t / 3_600_000 > lastHour) break;
      const r = rng(`${site}${d}${h}`);
      const shape = 0.25 + Math.sin(((h - 6) / 24) * Math.PI * 2 - Math.PI / 2) * -0.75 + 0.75; // evening peak
      const impressions = Math.round((day.impressions / 24) * shape * (0.8 + r() * 0.4));
      const clicks = Math.round(impressions * day.ctr * (0.85 + r() * 0.3));
      out.push({ keys: [`${d}T${String(h).padStart(2, "0")}:00:00-07:00`], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: day.position + (r() - 0.5) });
    }
  }
  return out;
}

function single(dim: string | undefined, req: SearchAnalyticsRequest, siteUrl: string, total: ReturnType<typeof totals>, seed: string, host: string): SearchAnalyticsRow[] {
  if (dim === "date") return datesIn(req).map((d) => ({ keys: [d], ...daily(d, siteUrl) }));
  if (dim === "hour") return hours(req, siteUrl);
  if (dim === "query") return distribute(QUERIES, total, seed + "q", { head: 0.9, posBase: 3 });
  if (dim === "page") return distribute(PAGES.map((p) => host + p), total, seed + "p", { head: 0.75, posBase: 4 });
  if (dim === "searchAppearance") return distribute(["FAQ_RICH_RESULT", "REVIEW_SNIPPET", "VIDEO", "BREADCRUMB"], { ...total, impressions: total.impressions * 0.3 }, seed + "a", { head: 1.2, posBase: 3 });
  if (dim === "country") return COUNTRIES.map(([c, s]) => ({ keys: [c], clicks: Math.round(total.clicks * s), impressions: Math.round(total.impressions * s), ctr: total.ctr, position: total.position + (c === "usa" ? -0.5 : 6) }));
  if (dim === "device") return DEVICES.map(([d, s]) => ({ keys: [d], clicks: Math.round(total.clicks * s), impressions: Math.round(total.impressions * s * (d === "DESKTOP" ? 1.2 : 0.9)), ctr: total.ctr * (d === "MOBILE" ? 1.05 : 0.9), position: total.position + (d === "MOBILE" ? -0.4 : 0.6) }));
  return [total];
}

export function demoAnalytics(siteUrl: string, req: SearchAnalyticsRequest): SearchAnalyticsRow[] {
  const dims = req.dimensions ?? [];
  if ((req.type === "discover" || req.type === "googleNews") && dims.includes("query")) {
    throw new Error("Google API 400: Discover and Google News don't support the query dimension.");
  }
  const total = totals(req, siteUrl);
  // Shares stay stable across periods (like real sites); totals carry the trend.
  const seed = `${siteUrl}|${req.type}|${Math.floor(parse(req.startDate) / (86_400_000 * 120))}`;
  const host = siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice(10)}` : siteUrl.replace(/\/$/, "");
  let rows: SearchAnalyticsRow[];
  if (dims.length === 2) {
    // Cross the first dimension's rows with the top keys of the second, splitting each row's totals.
    const outer = single(dims[0], req, siteUrl, total, seed, host);
    const inner = single(dims[1], req, siteUrl, total, seed, host).sort((a, b) => b.clicks - a.clicks).slice(0, dims[0] === "hour" ? 12 : 3);
    const innerSum = inner.reduce((n, r) => n + r.impressions, 0) || 1;
    rows = outer.flatMap((o) =>
      inner.map((i) => {
        const share = i.impressions / innerSum;
        const impressions = Math.max(1, Math.round(o.impressions * share));
        const clicks = Math.round(o.clicks * share);
        return { keys: [o.keys![0], i.keys![0]], clicks, impressions, ctr: clicks / impressions, position: (o.position + i.position) / 2 };
      }),
    );
  } else rows = single(dims[0], req, siteUrl, total, seed, host);
  // A query filter (branded / non-branded split) keeps a stable share of traffic.
  const qf = req.dimensionFilterGroups?.[0]?.filters.find((f) => f.dimension === "query");
  if (qf) {
    const share = qf.operator === "includingRegex" ? 0.22 : 0.78;
    rows = rows.map((r) => ({ ...r, clicks: Math.round(r.clicks * share), impressions: Math.round(r.impressions * share * (qf.operator === "includingRegex" ? 0.4 : 1.15)) }))
      .map((r) => ({ ...r, ctr: r.impressions ? r.clicks / r.impressions : 0, position: qf.operator === "includingRegex" ? 1.6 : r.position + 1.2 }));
  }
  if (req.type && req.type !== "web") rows = rows.map((r) => ({ ...r, clicks: Math.round(r.clicks * 0.08), impressions: Math.round(r.impressions * 0.15) }));
  return rows.sort((a, b) => b.clicks - a.clicks).slice(req.startRow ?? 0, (req.startRow ?? 0) + (req.rowLimit ?? 1000));
}

export function demoSitemaps(siteUrl: string) {
  const host = siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice(10)}` : siteUrl.replace(/\/$/, "");
  const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
  return [
    { path: `${host}/sitemap_index.xml`, lastSubmitted: ago(41), lastDownloaded: ago(1), isPending: false, isSitemapsIndex: true, type: "sitemap", warnings: "0", errors: "0", contents: [{ type: "web", submitted: "212" }] },
    { path: `${host}/post-sitemap.xml`, lastSubmitted: ago(41), lastDownloaded: ago(2), isPending: false, isSitemapsIndex: false, type: "sitemap", warnings: "2", errors: "0", contents: [{ type: "web", submitted: "64" }] },
    { path: `${host}/image-sitemap.xml`, lastSubmitted: ago(3), isPending: true, isSitemapsIndex: false, type: "sitemap", warnings: "0", errors: "0", contents: [] },
  ];
}

export function demoInspect(siteUrl: string, url: string) {
  const indexed = !/blog\/pex|draft|test/.test(url);
  const host = siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice(10)}` : siteUrl.replace(/\/$/, "");
  return {
    inspectionResult: {
      inspectionResultLink: "https://search.google.com/search-console",
      indexStatusResult: indexed
        ? { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", lastCrawlTime: new Date(Date.now() - 3 * DAY).toISOString(), pageFetchState: "SUCCESSFUL", googleCanonical: url, userCanonical: url, sitemap: [`${host}/sitemap_index.xml`], referringUrls: [`${host}/`, `${host}/blog/`], crawledAs: "MOBILE" }
        : { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", lastCrawlTime: new Date(Date.now() - 12 * DAY).toISOString(), pageFetchState: "SUCCESSFUL", crawledAs: "MOBILE" },
      richResultsResult: indexed ? { verdict: "PASS", detectedItems: [{ richResultType: "FAQ" }, { richResultType: "Breadcrumbs" }] } : undefined,
    },
  };
}
