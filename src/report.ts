// One-command report export: everything the Search Console UI's "Export"
// button gives you (and more), written as CSV + JSON + a Markdown summary
// that Claude Code, Antigravity or any agent can read directly.
import { promises as fs } from "node:fs";
import path from "node:path";
import * as gsc from "./gsc.js";
import { brandRegex } from "./store.js";
import { VERSION } from "./version.js";

export interface ReportOptions {
  siteUrl: string;
  days?: number;
  type?: gsc.SearchType;
  outDir: string;
  brandTerms?: string[];
}

export interface ReportResult {
  dir: string;
  files: string[];
  summary: string;
}

interface Row {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Compared extends Row {
  prev?: Row;
}

const RETENTION_DAYS = 485;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOffset = (n: number) => new Date(Date.now() - n * 86_400_000);
const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
const pos = (n?: number) => (n ? n.toFixed(1) : "");
const int = (n: number) => Math.round(n).toLocaleString("en-US");

export function siteSlug(siteUrl: string): string {
  return siteUrl.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/[^\w.-]+/g, "_");
}

function toRows(rows: gsc.SearchAnalyticsRow[]): Row[] {
  return rows.map((r) => ({ key: r.keys?.join(" | ") ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
}

function compare(cur: Row[], prev: Row[]): Compared[] {
  const before = new Map(prev.map((r) => [r.key, r]));
  return cur.map((r) => ({ ...r, prev: before.get(r.key) }));
}

function csv(header: string[], rows: Array<Array<string | number | undefined>>): string {
  const cell = (v: string | number | undefined) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // UTF-8 BOM so Excel opens non-ASCII queries correctly, like GSC's own export.
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

function comparedCsv(label: string, rows: Compared[], withPrev: boolean): string {
  const header = [label, "Clicks", "Impressions", "CTR", "Position"];
  if (withPrev) header.push("Previous clicks", "Previous impressions", "Previous CTR", "Previous position", "Click change", "Position change");
  return csv(
    header,
    rows.map((r) => {
      const base: Array<string | number | undefined> = [r.key, r.clicks, r.impressions, pct(r.ctr), pos(r.position)];
      if (withPrev) {
        base.push(r.prev?.clicks ?? 0, r.prev?.impressions ?? 0, r.prev ? pct(r.prev.ctr) : "", pos(r.prev?.position), r.clicks - (r.prev?.clicks ?? 0), r.prev ? (r.prev.position - r.position).toFixed(1) : "");
      }
      return base;
    }),
  );
}

function totals(rows: gsc.SearchAnalyticsRow[]): Row {
  const r = rows[0];
  return { key: "total", clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, ctr: r?.ctr ?? 0, position: r?.position ?? 0 };
}

function change(cur: number, prev: number): string {
  if (!prev) return cur ? "new" : "0%";
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

const EXPECTED_CTR = [0, 0.28, 0.16, 0.11, 0.08, 0.06, 0.045, 0.035, 0.03, 0.025, 0.02];

export async function exportReport(opts: ReportOptions): Promise<ReportResult> {
  const days = Math.min(Math.max(opts.days ?? 28, 1), RETENTION_DAYS);
  const type = opts.type ?? "web";
  const compareOn = days * 2 <= RETENTION_DAYS;
  const cur = { startDate: iso(dayOffset(days)), endDate: iso(dayOffset(1)) };
  const prev = { startDate: iso(dayOffset(days * 2)), endDate: iso(dayOffset(days + 1)) };
  const supportsQuery = type !== "discover" && type !== "googleNews";
  const base = { type, dataState: "all" as const };
  const site = opts.siteUrl;

  const q = (range: typeof cur, dimensions?: gsc.Dimension[]) => gsc.searchAnalyticsAll(site, { ...range, ...base, dimensions });
  const none = Promise.resolve([] as gsc.SearchAnalyticsRow[]);
  const brand = brandRegex(opts.brandTerms);
  const brandFilter = (op: "includingRegex" | "excludingRegex") => [{ groupType: "and" as const, filters: [{ dimension: "query" as const, operator: op, expression: brand! }] }];

  const [tCur, tPrev, dates, datesPrev, queries, queriesPrev, pages, pagesPrev, countries, countriesPrev, devices, devicesPrev, appearance, queryPage, sitemaps, branded, nonBranded] = await Promise.all([
    gsc.searchAnalyticsFull(site, { ...cur, ...base }),
    compareOn ? q(prev) : none,
    q(cur, ["date"]),
    compareOn ? q(prev, ["date"]) : none,
    supportsQuery ? q(cur, ["query"]) : none,
    supportsQuery && compareOn ? q(prev, ["query"]) : none,
    q(cur, ["page"]),
    compareOn ? q(prev, ["page"]) : none,
    q(cur, ["country"]),
    compareOn ? q(prev, ["country"]) : none,
    q(cur, ["device"]),
    compareOn ? q(prev, ["device"]) : none,
    q(cur, ["searchAppearance"]).catch(() => [] as gsc.SearchAnalyticsRow[]),
    supportsQuery ? gsc.searchAnalytics(site, { ...cur, ...base, dimensions: ["query", "page"], rowLimit: 25_000 }) : none,
    gsc.listSitemaps(site).catch(() => [] as unknown[]),
    brand && supportsQuery ? gsc.searchAnalytics(site, { ...cur, ...base, dimensionFilterGroups: brandFilter("includingRegex") }) : none,
    brand && supportsQuery ? gsc.searchAnalytics(site, { ...cur, ...base, dimensionFilterGroups: brandFilter("excludingRegex") }) : none,
  ]);

  const now = totals(tCur.rows);
  const before = compareOn ? totals(tPrev) : undefined;
  const qRows = compare(toRows(queries), toRows(queriesPrev));
  const pRows = compare(toRows(pages), toRows(pagesPrev));

  const dir = path.join(opts.outDir, siteSlug(site), `${cur.endDate}_last-${days}-days${type === "web" ? "" : `_${type}`}`);
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  const write = async (name: string, content: string) => {
    const f = path.join(dir, name);
    await fs.writeFile(f, content);
    files.push(f);
  };

  // Same files and column names as Search Console's own export, plus comparisons.
  const datePrevByIndex = toRows(datesPrev).sort((a, b) => a.key.localeCompare(b.key));
  await write(
    "Dates.csv",
    csv(
      ["Date", "Clicks", "Impressions", "CTR", "Position", ...(compareOn ? ["Previous date", "Previous clicks", "Previous impressions"] : [])],
      toRows(dates)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((r, i) => [r.key, r.clicks, r.impressions, pct(r.ctr), pos(r.position), ...(compareOn ? [datePrevByIndex[i]?.key, datePrevByIndex[i]?.clicks, datePrevByIndex[i]?.impressions] : [])]),
    ),
  );
  if (supportsQuery) await write("Queries.csv", comparedCsv("Top queries", qRows, compareOn));
  await write("Pages.csv", comparedCsv("Top pages", pRows, compareOn));
  await write("Countries.csv", comparedCsv("Country", compare(toRows(countries), toRows(countriesPrev)), compareOn));
  await write("Devices.csv", comparedCsv("Device", compare(toRows(devices), toRows(devicesPrev)), compareOn));
  await write("Search appearance.csv", csv(["Search appearance", "Clicks", "Impressions", "CTR", "Position"], toRows(appearance).map((r) => [r.key, r.clicks, r.impressions, pct(r.ctr), pos(r.position)])));
  if (supportsQuery) {
    await write(
      "Query-page pairs.csv",
      csv(["Query", "Page", "Clicks", "Impressions", "CTR", "Position"], queryPage.map((r) => [r.keys?.[0], r.keys?.[1], r.clicks, r.impressions, pct(r.ctr), pos(r.position)])),
    );
  }
  await write(
    "Sitemaps.csv",
    csv(
      ["Sitemap", "Type", "Last submitted", "Last downloaded", "Pending", "Errors", "Warnings", "Submitted URLs"],
      (sitemaps as Array<Record<string, any>>).map((s) => [s.path, s.isSitemapsIndex ? "index" : s.type, s.lastSubmitted, s.lastDownloaded, String(Boolean(s.isPending)), s.errors, s.warnings, (s.contents ?? []).reduce((n: number, c: any) => n + Number(c.submitted ?? 0), 0)]),
    ),
  );
  await write(
    "Filters.csv",
    csv(["Filter", "Value"], [["Property", site], ["Search type", type], ["Date", `${cur.startDate} to ${cur.endDate}`], ["Compared with", compareOn ? `${prev.startDate} to ${prev.endDate}` : "none (beyond 16-month retention)"], ["Data state", "all (includes fresh, preliminary data)"]]),
  );

  // Markdown summary written for an AI agent (and humans) to act on.
  const top = <T extends Row>(rows: T[], n: number, by: (r: T) => number) => [...rows].sort((a, b) => by(b) - by(a)).slice(0, n);
  const tableOf = (label: string, rows: Compared[]) =>
    [`| ${label} | Clicks | Impr. | CTR | Pos. |${compareOn ? " Δ clicks |" : ""}`, `|---|---:|---:|---:|---:|${compareOn ? "---:|" : ""}`, ...rows.map((r) => `| ${r.key.replace(/\|/g, "\\|")} | ${int(r.clicks)} | ${int(r.impressions)} | ${pct(r.ctr)} | ${pos(r.position)} |${compareOn ? ` ${r.clicks - (r.prev?.clicks ?? 0) >= 0 ? "+" : ""}${int(r.clicks - (r.prev?.clicks ?? 0))} |` : ""}`)].join("\n");

  const striking = qRows.filter((r) => r.position >= 3.5 && r.position <= 20.5 && r.impressions >= Math.max(10, days * 1.5));
  const lowCtr = pRows
    .filter((r) => r.position <= 10 && r.impressions >= Math.max(30, days * 4))
    .map((r) => ({ ...r, expected: EXPECTED_CTR[Math.max(1, Math.round(r.position))] ?? 0.02 }))
    .filter((r) => r.ctr < r.expected * 0.6);
  const movers = compareOn ? qRows.map((r) => ({ ...r, d: r.clicks - (r.prev?.clicks ?? 0) })) : [];

  const s: string[] = [
    `# Search Console report: ${site}`,
    "",
    `Search type **${type}**, ${cur.startDate} to ${cur.endDate} (${days} days)${compareOn ? `, compared with ${prev.startDate} to ${prev.endDate}` : ""}. Generated ${new Date().toISOString()} by google-search-console-connector ${VERSION}. Includes fresh data that Google may still revise${tCur.metadata?.first_incomplete_date ? ` (data from ${tCur.metadata.first_incomplete_date} is incomplete)` : ""}. Web results include AI Overviews and AI Mode; Google's API does not separate them.`,
    "",
    "## Totals",
    "",
    "| Metric | This period | Previous | Change |",
    "|---|---:|---:|---:|",
    `| Clicks | ${int(now.clicks)} | ${before ? int(before.clicks) : "–"} | ${before ? change(now.clicks, before.clicks) : "–"} |`,
    `| Impressions | ${int(now.impressions)} | ${before ? int(before.impressions) : "–"} | ${before ? change(now.impressions, before.impressions) : "–"} |`,
    `| CTR | ${pct(now.ctr)} | ${before ? pct(before.ctr) : "–"} | ${before ? `${((now.ctr - before.ctr) * 100).toFixed(2)} pp` : "–"} |`,
    `| Avg. position | ${pos(now.position)} | ${before ? pos(before.position) : "–"} | ${before ? `${(before.position - now.position >= 0 ? "+" : "")}${(before.position - now.position).toFixed(1)} (positive = better)` : "–"} |`,
    "",
  ];
  if (brand && supportsQuery) {
    const b = totals(branded);
    const nb = totals(nonBranded);
    s.push("## Branded vs non-branded", "", `Brand terms: ${opts.brandTerms!.join(", ")}`, "", "| Segment | Clicks | Impressions | CTR | Position |", "|---|---:|---:|---:|---:|", `| Branded | ${int(b.clicks)} | ${int(b.impressions)} | ${pct(b.ctr)} | ${pos(b.position)} |`, `| Non-branded | ${int(nb.clicks)} | ${int(nb.impressions)} | ${pct(nb.ctr)} | ${pos(nb.position)} |`, "");
  }
  if (supportsQuery) s.push("## Top queries", "", tableOf("Query", top(qRows, 20, (r) => r.clicks)), "");
  s.push("## Top pages", "", tableOf("Page", top(pRows, 20, (r) => r.clicks)), "");
  if (movers.length) {
    s.push("## Biggest query gains", "", tableOf("Query", top(movers, 10, (r) => r.d).filter((r) => r.d > 0)), "");
    s.push("## Biggest query losses", "", tableOf("Query", top(movers, 10, (r) => -r.d).filter((r) => r.d < 0)), "");
  }
  if (striking.length) s.push("## Striking distance (positions 4–20)", "", "Queries close to the top 3, ranked by impressions. Improving the matching page usually pays off fastest.", "", tableOf("Query", top(striking, 20, (r) => r.impressions)), "");
  if (lowCtr.length) s.push("## Page-one pages with low CTR", "", "Clicked far less than is typical for their position. Rewrite the title and meta description.", "", tableOf("Page", top(lowCtr, 15, (r) => r.impressions)), "");
  s.push("## Files", "", ...files.map((f) => `- ${path.basename(f)}`), "- report.json", "");
  const summary = s.join("\n");
  await write("summary.md", summary);
  await write(
    "report.json",
    JSON.stringify({ site, type, days, period: cur, previousPeriod: compareOn ? prev : null, totals: now, previousTotals: before ?? null, metadata: tCur.metadata ?? null, queries: qRows, pages: pRows, countries: toRows(countries), devices: toRows(devices), searchAppearance: toRows(appearance), sitemaps }, null, 2),
  );
  return { dir, files, summary };
}

/** Keep exported Search Console data out of git (and out of static-site deploys). */
export async function ensureGitignored(projectDir: string, relDir: string): Promise<boolean> {
  const gi = path.join(projectDir, ".gitignore");
  let text: string;
  try {
    text = await fs.readFile(gi, "utf8");
  } catch {
    return false;
  }
  const entry = relDir.replace(/\\/g, "/").replace(/\/?$/, "/");
  if (text.split(/\r?\n/).some((l) => l.trim() === entry || l.trim() === entry.slice(0, -1))) return false;
  await fs.appendFile(gi, `${text.endsWith("\n") ? "" : "\n"}# Search Console exports (google-search-console-connector)\n${entry}\n`);
  return true;
}
