// MCP server: exposes Google Search Console to Claude Code over stdio.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import open from "open";
import { z } from "zod";
import { type AppServer, startAppServer } from "./app-server.js";
import * as gsc from "./gsc.js";
import { revokeAndClear } from "./oauth.js";
import { ensureGitignored, exportReport } from "./report.js";
import { brandRegex, loadClient, loadProjectLink, loadTokens, saveProjectLink } from "./store.js";
import { track } from "./telemetry.js";
import { latestVersion, updateCommand } from "./update-check.js";
import { VERSION } from "./version.js";

const projectDir = process.env.GSC_PROJECT_DIR ?? process.cwd();

let app: AppServer | undefined;
async function getApp(): Promise<AppServer> {
  app ??= await startAppServer(projectDir);
  return app;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});

function guard<A>(tool: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      const result = await fn(args);
      void track("mcp_tool_called", { tool, ok: true });
      return result;
    } catch (err) {
      void track("mcp_tool_called", { tool, ok: false });
      return { content: [{ type: "text", text: (err as Error).message }], isError: true };
    }
  };
}

async function resolveSite(siteUrl?: string): Promise<string> {
  if (siteUrl) return siteUrl;
  const link = await loadProjectLink(projectDir);
  if (link) return link.siteUrl;
  throw new Error(
    `No siteUrl given and ${projectDir} is not linked to a Search Console property. Pass siteUrl, or call gsc_link_project (gsc_list_sites shows the options).`,
  );
}

const siteUrlArg = z
  .string()
  .optional()
  .describe("Property: 'sc-domain:example.com' (domain property) or 'https://example.com/' (URL-prefix, trailing slash). Defaults to the project's linked property.");

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const filterSchema = z.object({
  dimension: z.enum(["query", "page", "country", "device", "searchAppearance"]),
  operator: z.enum(["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"]).default("contains"),
  expression: z.string(),
});

function sum(rows: gsc.SearchAnalyticsRow[]) {
  const r = rows[0];
  return r
    ? { clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position, 1) }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

const pct = (cur: number, prev: number) => (prev ? `${round(((cur - prev) / prev) * 100, 1)}%` : "n/a");

async function exportSummary(folder: string): Promise<string> {
  const text = await readFile(path.join(folder, "summary.md"), "utf8");
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[truncated: read summary.md for the rest]` : text;
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: "google-search-console", version: VERSION },
    {
      instructions:
        "Google Search Console for the current website project. If a tool says you are not connected, call gsc_connect (it opens a browser window for the user). " +
        "Tools default to the property linked in .gsc-connect.json. To add a new site: gsc_add_site, gsc_get_verification_token (META), put the meta tag in the site's <head>, deploy, then gsc_verify_site.",
    },
  );

  server.registerTool(
    "gsc_connect",
    {
      title: "Connect Google Search Console",
      description:
        "Open the Connect page in the user's browser: Google Cloud setup, Google sign-in, and choosing this project's property. Waits until the user finishes (up to 10 minutes).",
      inputSchema: {},
    },
    guard("gsc_connect", async () => {
      const a = await getApp();
      const url = a.launchUrl("connect");
      await open(url).catch(() => undefined);
      const result = await a.waitForConnection(10 * 60_000);
      return ok({
        connected: true,
        account: result.email,
        linkedProperty: result.siteUrl ?? null,
        projectFile: result.projectFile ?? null,
        dashboard: "Call gsc_open_dashboard to view metrics.",
      });
    }),
  );

  server.registerTool(
    "gsc_open_dashboard",
    {
      title: "Open the GSC dashboard",
      description: "Open the local Search Console dashboard (performance, queries, pages, opportunities, indexing) in the user's browser.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard("gsc_open_dashboard", async () => {
      if (!(await loadTokens())) throw new Error("Not connected yet. Call gsc_connect first.");
      const a = await getApp();
      const url = a.launchUrl("dashboard");
      await open(url).catch(() => undefined);
      return ok(`Dashboard opened at ${a.url}/dashboard (if no window appeared, open this one-time link: ${url})`);
    }),
  );

  server.registerTool(
    "gsc_status",
    {
      title: "Connection status",
      description: "Show whether Google is connected, which account, and which property this project is linked to.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard("gsc_status", async () => {
      const [client, tokens, link] = await Promise.all([loadClient(), loadTokens(), loadProjectLink(projectDir)]);
      return ok({
        oauthClientConfigured: Boolean(client),
        connected: Boolean(tokens),
        account: tokens?.email ?? null,
        projectDir,
        linkedProperty: link?.siteUrl ?? null,
        brandTerms: link?.brandTerms ?? [],
        version: VERSION,
        updateAvailable: (await latestVersion()) ? `${await latestVersion()} (restart Claude Code to pick it up if installed with ${updateCommand}; otherwise update your install)` : null,
      });
    }),
  );

  server.registerTool(
    "gsc_disconnect",
    {
      title: "Disconnect Google",
      description: "Revoke this machine's Google access token and delete it locally.",
      inputSchema: {},
      annotations: { destructiveHint: true },
    },
    guard("gsc_disconnect", async () => {
      await revokeAndClear();
      return ok("Disconnected. Google access has been revoked.");
    }),
  );

  server.registerTool(
    "gsc_list_sites",
    {
      title: "List properties",
      description: "List Search Console properties the connected account can access, with permission level.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard("gsc_list_sites", async () => ok(await gsc.listSites())),
  );

  server.registerTool(
    "gsc_link_project",
    {
      title: "Link project to property",
      description: "Save which Search Console property this website project uses (writes .gsc-connect.json in the project root; contains no secrets).",
      inputSchema: { siteUrl: z.string().describe("Property URL exactly as gsc_list_sites returns it") },
    },
    guard("gsc_link_project", async ({ siteUrl }: { siteUrl: string }) => {
      const file = await saveProjectLink(projectDir, { siteUrl });
      return ok(`Linked ${projectDir} to ${siteUrl} (${file}).`);
    }),
  );

  server.registerTool(
    "gsc_search_analytics",
    {
      title: "Search analytics query",
      description:
        "Query Search Console performance data (clicks, impressions, CTR, position). Data is available for the last 16 months and usually lags 2–3 days. CTR is returned as a fraction.",
      inputSchema: {
        siteUrl: siteUrlArg,
        startDate: dateArg.optional().describe("Default: 28 days ago"),
        endDate: dateArg.optional().describe("Default: yesterday"),
        dimensions: z
          .array(z.enum(["date", "hour", "query", "page", "country", "device", "searchAppearance"]))
          .optional()
          .describe("'hour' returns hourly rows for the last ~10 days (dataState hourly_all). Discover and Google News don't support 'query'."),
        filters: z.array(filterSchema).optional().describe("ANDed together. Regex operators use RE2 syntax."),
        queryType: z.enum(["all", "branded", "nonBranded"]).optional().describe("Uses the project's brand terms (gsc_set_brand_terms)"),
        type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).optional().describe("Default web. Web includes AI Overviews and AI Mode; the API can't separate them."),
        rowLimit: z.number().int().min(1).max(25000).optional().describe("Default 100"),
        startRow: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guard("gsc_search_analytics", async (a: {
      siteUrl?: string;
      startDate?: string;
      endDate?: string;
      dimensions?: gsc.Dimension[];
      filters?: z.infer<typeof filterSchema>[];
      queryType?: "all" | "branded" | "nonBranded";
      type?: gsc.SearchAnalyticsRequest["type"];
      rowLimit?: number;
      startRow?: number;
    }) => {
      const siteUrl = await resolveSite(a.siteUrl);
      const filters = [...(a.filters ?? [])];
      if (a.queryType && a.queryType !== "all") {
        const regex = brandRegex((await loadProjectLink(projectDir))?.brandTerms);
        if (!regex) throw new Error("No brand terms set for this project. Call gsc_set_brand_terms first.");
        filters.push({ dimension: "query", operator: a.queryType === "branded" ? "includingRegex" : "excludingRegex", expression: regex });
      }
      const hourly = a.dimensions?.includes("hour");
      const { rows, metadata } = await gsc.searchAnalyticsFull(siteUrl, {
        startDate: a.startDate ?? gsc.daysAgo(hourly ? 3 : 28),
        endDate: a.endDate ?? gsc.daysAgo(hourly ? 0 : 1),
        dimensions: a.dimensions,
        type: a.type,
        dimensionFilterGroups: filters.length ? [{ groupType: "and", filters }] : undefined,
        rowLimit: a.rowLimit ?? 100,
        startRow: a.startRow,
        dataState: hourly ? "hourly_all" : "all",
      });
      return ok({ siteUrl, rowCount: rows.length, metadata, rows });
    }),
  );

  server.registerTool(
    "gsc_performance_summary",
    {
      title: "Performance summary",
      description: "Totals for a period compared with the previous period of equal length, plus top queries and pages. A good first call for 'how is the site doing?'.",
      inputSchema: {
        siteUrl: siteUrlArg,
        days: z.number().int().min(1).max(480).optional().describe("Period length in days, ending yesterday. Default 28."),
        top: z.number().int().min(1).max(100).optional().describe("Top queries/pages to include. Default 10."),
      },
      annotations: { readOnlyHint: true },
    },
    guard("gsc_performance_summary", async ({ siteUrl: s, days = 28, top = 10 }: { siteUrl?: string; days?: number; top?: number }) => {
      const siteUrl = await resolveSite(s);
      const cur = { startDate: gsc.daysAgo(days), endDate: gsc.daysAgo(1) };
      const prev = { startDate: gsc.daysAgo(days * 2), endDate: gsc.daysAgo(days + 1) };
      const q = (range: typeof cur, dimensions?: gsc.Dimension[], rowLimit = top) =>
        gsc.searchAnalytics(siteUrl, { ...range, dimensions, rowLimit, dataState: "all" });
      const [tc, tp, queries, pages] = await Promise.all([q(cur), q(prev), q(cur, ["query"]), q(cur, ["page"])]);
      const now = sum(tc);
      const before = sum(tp);
      const fmt = (rows: gsc.SearchAnalyticsRow[]) =>
        rows.map((r) => ({ key: r.keys?.[0], clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 2), position: round(r.position, 1) }));
      return ok({
        siteUrl,
        period: cur,
        previousPeriod: prev,
        totals: now,
        previousTotals: before,
        change: {
          clicks: pct(now.clicks, before.clicks),
          impressions: pct(now.impressions, before.impressions),
          ctrPoints: round(now.ctr - before.ctr, 2),
          position: round(now.position - before.position, 1),
        },
        topQueries: fmt(queries),
        topPages: fmt(pages),
        note: "CTR in percent. Lower position is better.",
      });
    }),
  );

  server.registerTool(
    "gsc_inspect_url",
    {
      title: "Inspect URL",
      description: "URL Inspection: index status, coverage, last crawl, canonical, mobile usability, and rich results for one URL in the property.",
      inputSchema: {
        url: z.string().url().describe("Fully-qualified URL that belongs to the property"),
        siteUrl: siteUrlArg,
      },
      annotations: { readOnlyHint: true },
    },
    guard("gsc_inspect_url", async ({ url, siteUrl }: { url: string; siteUrl?: string }) => ok(await gsc.inspectUrl(await resolveSite(siteUrl), url))),
  );

  server.registerTool(
    "gsc_list_sitemaps",
    {
      title: "List sitemaps",
      description: "Sitemaps submitted for the property, with status, errors, warnings and last download time.",
      inputSchema: { siteUrl: siteUrlArg },
      annotations: { readOnlyHint: true },
    },
    guard("gsc_list_sitemaps", async ({ siteUrl }: { siteUrl?: string }) => ok(await gsc.listSitemaps(await resolveSite(siteUrl)))),
  );

  server.registerTool(
    "gsc_submit_sitemap",
    {
      title: "Submit sitemap",
      description: "Submit (or resubmit) a sitemap URL for the property.",
      inputSchema: { feedpath: z.string().url().describe("e.g. https://example.com/sitemap.xml"), siteUrl: siteUrlArg },
    },
    guard("gsc_submit_sitemap", async ({ feedpath, siteUrl }: { feedpath: string; siteUrl?: string }) => {
      const s = await resolveSite(siteUrl);
      await gsc.submitSitemap(s, feedpath);
      return ok(`Submitted ${feedpath} to ${s}.`);
    }),
  );

  server.registerTool(
    "gsc_delete_sitemap",
    {
      title: "Delete sitemap",
      description: "Remove a sitemap from the property in Search Console (does not touch the file on the website).",
      inputSchema: { feedpath: z.string().url(), siteUrl: siteUrlArg },
      annotations: { destructiveHint: true },
    },
    guard("gsc_delete_sitemap", async ({ feedpath, siteUrl }: { feedpath: string; siteUrl?: string }) => {
      const s = await resolveSite(siteUrl);
      await gsc.deleteSitemap(s, feedpath);
      return ok(`Removed ${feedpath} from ${s}.`);
    }),
  );

  server.registerTool(
    "gsc_add_site",
    {
      title: "Add property",
      description: "Add a property to Search Console for the connected account. It stays unverified until gsc_verify_site succeeds.",
      inputSchema: { siteUrl: z.string().describe("'https://example.com/' or 'sc-domain:example.com'") },
    },
    guard("gsc_add_site", async ({ siteUrl }: { siteUrl: string }) => {
      await gsc.addSite(siteUrl);
      return ok(`Added ${siteUrl}. Next: gsc_get_verification_token.`);
    }),
  );

  server.registerTool(
    "gsc_get_verification_token",
    {
      title: "Get verification token",
      description:
        "Get the ownership verification token. META returns a <meta> tag for the site's <head> (URL-prefix properties). FILE returns an HTML file name/content to serve at the site root. DNS_TXT is required for sc-domain properties.",
      inputSchema: {
        siteUrl: z.string(),
        method: z.enum(["META", "FILE", "DNS_TXT", "DNS_CNAME"]).default("META"),
      },
      annotations: { readOnlyHint: true },
    },
    guard("gsc_get_verification_token", async ({ siteUrl, method }: { siteUrl: string; method: gsc.VerificationMethod }) => {
      const res = await gsc.getVerificationToken(siteUrl, method);
      const how: Record<string, string> = {
        META: "Add this tag inside <head> on the home page, deploy, then call gsc_verify_site.",
        FILE: `Serve a file named ${res.token} at the site root containing exactly: google-site-verification: ${res.token}. Deploy, then call gsc_verify_site.`,
        DNS_TXT: "Add this as a TXT record on the domain's DNS, wait for it to propagate, then call gsc_verify_site.",
        DNS_CNAME: "Add this CNAME record on the domain's DNS, wait for it to propagate, then call gsc_verify_site.",
      };
      return ok({ ...res, instructions: how[method] });
    }),
  );

  server.registerTool(
    "gsc_verify_site",
    {
      title: "Verify ownership",
      description: "Ask Google to check the verification token placed by the chosen method. Run after deploying the meta tag / file or adding the DNS record.",
      inputSchema: {
        siteUrl: z.string(),
        method: z.enum(["META", "FILE", "DNS_TXT", "DNS_CNAME"]).default("META"),
      },
    },
    guard("gsc_verify_site", async ({ siteUrl, method }: { siteUrl: string; method: gsc.VerificationMethod }) => {
      const res = await gsc.verifySite(siteUrl, method);
      return ok({ verified: true, ...res, next: "Call gsc_link_project to make it this project's default property." });
    }),
  );

  server.registerTool(
    "gsc_export_report",
    {
      title: "Export Search Console reports",
      description:
        "Download Search Console reports in one step: Dates, Queries, Pages, Countries, Devices, Search appearance, Query-page pairs and Sitemaps as CSV (same columns as Search Console's Export, plus previous-period comparison), report.json, and summary.md written for you to read next. Saved to .gsc-reports/ in the project (added to .gitignore).",
      inputSchema: {
        siteUrl: siteUrlArg,
        days: z.number().int().min(1).max(485).optional().describe("Default 28"),
        type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).optional(),
        allSites: z.boolean().optional().describe("Export every property the account can access"),
      },
    },
    guard("gsc_export_report", async ({ siteUrl, days, type, allSites }: { siteUrl?: string; days?: number; type?: gsc.SearchType; allSites?: boolean }) => {
      const link = await loadProjectLink(projectDir);
      const sites = allSites
        ? (await gsc.listSites()).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl)
        : [await resolveSite(siteUrl)];
      const outDir = path.join(projectDir, ".gsc-reports");
      const results = [];
      for (const s of sites) {
        const r = await exportReport({ siteUrl: s, days, type, outDir, brandTerms: s === link?.siteUrl ? link?.brandTerms : undefined });
        results.push({ site: s, folder: r.dir, files: r.files.map((f) => path.basename(f)) });
      }
      const ignored = await ensureGitignored(projectDir, ".gsc-reports");
      const summary = results.length === 1 ? await exportSummary(results[0].folder) : "Read summary.md in each folder.";
      return ok({ exported: results, addedToGitignore: ignored, summary });
    }),
  );

  server.registerTool(
    "gsc_add_annotation",
    {
      title: "Add chart note",
      description:
        "Add a dated note to this project's performance chart, e.g. after deploying SEO changes ('Rewrote service page titles'). Shown in the dashboard so changes can be matched to traffic movements.",
      inputSchema: {
        text: z.string().min(1).max(120),
        date: dateArg.optional().describe("Default today"),
      },
    },
    guard("gsc_add_annotation", async ({ text, date }: { text: string; date?: string }) => {
      const day = date ?? gsc.daysAgo(0);
      const link = await loadProjectLink(projectDir);
      const annotations = [...(link?.annotations ?? []), { date: day, text, source: "claude" as const }].sort((a, b) => a.date.localeCompare(b.date));
      await saveProjectLink(projectDir, { annotations });
      return ok(`Added note for ${day}: ${text}`);
    }),
  );

  server.registerTool(
    "gsc_set_brand_terms",
    {
      title: "Set brand terms",
      description:
        "Set the words that make a query 'branded' (business name, product names, common misspellings). Enables branded vs non-branded analysis in gsc_search_analytics, reports and the dashboard.",
      inputSchema: { terms: z.array(z.string().min(1).max(60)).max(30) },
    },
    guard("gsc_set_brand_terms", async ({ terms }: { terms: string[] }) => {
      await saveProjectLink(projectDir, { brandTerms: terms });
      return ok(`Brand terms saved: ${terms.join(", ") || "(none)"}`);
    }),
  );

  await server.connect(new StdioServerTransport());
}
