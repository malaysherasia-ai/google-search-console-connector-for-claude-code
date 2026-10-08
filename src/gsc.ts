// Thin client for the Search Console and Site Verification REST APIs.
// Plain fetch keeps the dependency tree small and auditable.
import * as demo from "./demo.js";
import { getAccessToken } from "./oauth.js";

/** GSC_CONNECT_DEMO=1 serves synthetic data and never calls Google. */
export const isDemo = () => process.env.GSC_CONNECT_DEMO === "1";

const WEBMASTERS = "https://searchconsole.googleapis.com/webmasters/v3";
const INSPECTION = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const VERIFICATION = "https://www.googleapis.com/siteVerification/v1";

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    let msg = json?.error?.message ?? res.statusText;
    if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
      msg += " — enable the API in Google Cloud Console for the project that owns your OAuth client.";
    }
    throw new GoogleApiError(res.status, `Google API ${res.status}: ${msg}`);
  }
  return json as T;
}

const enc = encodeURIComponent;

export interface Site {
  siteUrl: string;
  permissionLevel: string;
}

export async function listSites(): Promise<Site[]> {
  if (isDemo()) return demo.DEMO_SITES;
  const res = await call<{ siteEntry?: Site[] }>("GET", `${WEBMASTERS}/sites`);
  return (res.siteEntry ?? []).sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export const addSite = (siteUrl: string) =>
  call<void>("PUT", `${WEBMASTERS}/sites/${enc(siteUrl)}`);

export const removeSite = (siteUrl: string) =>
  call<void>("DELETE", `${WEBMASTERS}/sites/${enc(siteUrl)}`);

export type Dimension = "date" | "hour" | "query" | "page" | "country" | "device" | "searchAppearance";

export const SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: Dimension[];
  type?: SearchType;
  dimensionFilterGroups?: Array<{
    groupType?: "and";
    filters: Array<{
      dimension: Exclude<Dimension, "date" | "hour">;
      operator: "equals" | "notEquals" | "contains" | "notContains" | "includingRegex" | "excludingRegex";
      expression: string;
    }>;
  }>;
  aggregationType?: "auto" | "byPage" | "byProperty" | "byNewsShowcasePanel";
  rowLimit?: number;
  startRow?: number;
  /** "hourly_all" is required with the "hour" dimension (up to 10 days back). */
  dataState?: "final" | "all" | "hourly_all";
}

/** Marks where fresh data is still being processed (times in America/Los_Angeles). */
export interface SearchAnalyticsMetadata {
  first_incomplete_date?: string;
  first_incomplete_hour?: string;
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function searchAnalyticsFull(
  siteUrl: string,
  req: SearchAnalyticsRequest,
): Promise<{ rows: SearchAnalyticsRow[]; metadata?: SearchAnalyticsMetadata }> {
  if (isDemo()) return { rows: demo.demoAnalytics(siteUrl, req) };
  const res = await call<{ rows?: SearchAnalyticsRow[]; metadata?: SearchAnalyticsMetadata }>(
    "POST",
    `${WEBMASTERS}/sites/${enc(siteUrl)}/searchAnalytics/query`,
    req,
  );
  return { rows: res.rows ?? [], metadata: res.metadata };
}

export async function searchAnalytics(siteUrl: string, req: SearchAnalyticsRequest): Promise<SearchAnalyticsRow[]> {
  return (await searchAnalyticsFull(siteUrl, req)).rows;
}

/** All rows for a query, paging past the 25,000-row limit (Google exposes at most 50,000 a day per type). */
export async function searchAnalyticsAll(siteUrl: string, req: SearchAnalyticsRequest, max = 100_000): Promise<SearchAnalyticsRow[]> {
  const out: SearchAnalyticsRow[] = [];
  for (let startRow = 0; startRow < max; startRow += 25_000) {
    const rows = await searchAnalytics(siteUrl, { ...req, rowLimit: 25_000, startRow });
    out.push(...rows);
    if (rows.length < 25_000) break;
  }
  return out;
}

export const inspectUrl = (siteUrl: string, inspectionUrl: string, languageCode = "en-US") =>
  isDemo() ? Promise.resolve(demo.demoInspect(siteUrl, inspectionUrl)) : call<{ inspectionResult: unknown }>("POST", INSPECTION, { siteUrl, inspectionUrl, languageCode });

export async function listSitemaps(siteUrl: string): Promise<unknown[]> {
  if (isDemo()) return demo.demoSitemaps(siteUrl);
  const res = await call<{ sitemap?: unknown[] }>("GET", `${WEBMASTERS}/sites/${enc(siteUrl)}/sitemaps`);
  return res.sitemap ?? [];
}

export const submitSitemap = (siteUrl: string, feedpath: string) =>
  call<void>("PUT", `${WEBMASTERS}/sites/${enc(siteUrl)}/sitemaps/${enc(feedpath)}`);

export const deleteSitemap = (siteUrl: string, feedpath: string) =>
  call<void>("DELETE", `${WEBMASTERS}/sites/${enc(siteUrl)}/sitemaps/${enc(feedpath)}`);

export type VerificationMethod = "META" | "FILE" | "DNS_TXT" | "DNS_CNAME" | "ANALYTICS" | "TAG_MANAGER";

/** "sc-domain:example.com" -> domain property; anything else -> URL-prefix property. */
function verificationSite(siteUrl: string) {
  return siteUrl.startsWith("sc-domain:")
    ? { type: "INET_DOMAIN", identifier: siteUrl.slice("sc-domain:".length) }
    : { type: "SITE", identifier: siteUrl };
}

export const getVerificationToken = (siteUrl: string, method: VerificationMethod) =>
  call<{ method: string; token: string }>("POST", `${VERIFICATION}/token`, {
    site: verificationSite(siteUrl),
    verificationMethod: method,
  });

export const verifySite = (siteUrl: string, method: VerificationMethod) =>
  call<{ id: string; site: unknown; owners: string[] }>(
    "POST",
    `${VERIFICATION}/webResource?verificationMethod=${method}`,
    { site: verificationSite(siteUrl) },
  );

/** ISO date (YYYY-MM-DD) `days` ago, in UTC — GSC data is reported in PT but UTC is close enough for ranges. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
