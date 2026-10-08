// Local web app (Connect onboarding + Dashboard), bound to 127.0.0.1 only.
//
// Security model:
//  - Listens on the loopback interface only.
//  - The browser is opened with a one-time launch token, exchanged for an
//    HttpOnly SameSite=Lax session cookie; every /api route requires it.
//  - Host header must be 127.0.0.1/localhost (blocks DNS-rebinding).
//  - State-changing routes are POST + application/json (no simple-form CSRF).
//  - The OAuth callback is validated with `state` and PKCE.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as demo from "./demo.js";
import * as gsc from "./gsc.js";
import { type PendingAuth, VERIFY_SCOPE, createAuthRequest, exchangeCode, hasScope, revokeAndClear } from "./oauth.js";
import { BUILTIN_VERIFIED, hasBuiltinClient } from "./builtin-client.js";
import {
  type Annotation,
  brandRegex,
  CONFIG_DIR_DISPLAY,
  loadClient,
  loadProjectLink,
  loadTokens,
  parseClientJson,
  saveClient,
  clearTokens,
  loadClientInfo,
  removeClient,
  saveProjectLink,
  validateClient,
} from "./store.js";
import * as telemetry from "./telemetry.js";
import { latestVersion } from "./update-check.js";
import { VERSION } from "./version.js";

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const PREFERRED_PORT = Number(process.env.GSC_CONNECT_PORT ?? 4817);
const COOKIE = "gscc_session";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export interface AppServer {
  url: string;
  port: number;
  /** URL that logs the browser in; open it, don't share it. */
  launchUrl(page?: "connect" | "dashboard", upgrade?: "verify"): string;
  /** Resolves when the user finishes the Connect flow. */
  waitForConnection(timeoutMs: number): Promise<ConnectResult>;
  close(): Promise<void>;
}

export interface ConnectResult {
  email?: string;
  siteUrl?: string;
  projectFile?: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startAppServer(projectDir: string, opts: { demo?: boolean } = {}): Promise<AppServer> {
  const isDemo = Boolean(opts.demo);
  let updateAvailable: string | null = null;
  void latestVersion().then((v) => (updateAvailable = v));
  if (isDemo) process.env.GSC_CONNECT_DEMO = "1";
  // Demo notes live in memory so trying the dashboard never writes files.
  const demoProject = { brandTerms: ["northshore"], annotations: [{ date: isoDaysAgo(19), text: "Rewrote service-page titles", source: "claude" }, { date: isoDaysAgo(6), text: "Launched Wilmette location page", source: "dashboard" }] as Annotation[] };
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const launchTokens = new Set<string>();
  let pending: PendingAuth | undefined;
  let lastResult: ConnectResult | undefined;
  const waiters = new Set<(r: ConnectResult) => void>();

  const finish = (result: ConnectResult) => {
    lastResult = result;
    for (const w of waiters) w(result);
    waiters.clear();
  };

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof gsc.GoogleApiError ? 502 : 500;
      const message = (err as Error).message ?? "Unexpected error";
      if (req.url?.startsWith("/api/")) {
        send(res, status, JSON.stringify({ error: message }), "application/json");
      } else {
        send(res, status, message, "text/plain; charset=utf-8");
      }
    }
  });

  const port = await listen(server, PREFERRED_PORT);
  const origin = `http://127.0.0.1:${port}`;

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      throw new HttpError(421, "Unexpected Host header");
    }
    const url = new URL(req.url ?? "/", origin);
    const p = url.pathname;

    // One-time launch link -> session cookie.
    if (p === "/launch") {
      const t = url.searchParams.get("t") ?? "";
      if (!launchTokens.delete(t)) throw new HttpError(403, "This link has expired. Open the dashboard again from Claude Code or the CLI.");
      res.setHeader("Set-Cookie", `${COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}`);
      const next = url.searchParams.get("next") === "dashboard" ? "/dashboard" : url.searchParams.get("upgrade") === "verify" ? "/connect?upgrade=verify" : "/connect";
      return redirect(res, next);
    }

    // Google redirects here; validated by state + PKCE rather than the cookie.
    if (p === "/oauth/callback") return oauthCallback(url, res);

    // Static CSS/JS/images hold no data, and the signed-out page needs them.
    if (req.method === "GET" && p.startsWith("/assets/")) return serveAsset(p, res);

    if (!hasSession(req)) {
      if (p.startsWith("/api/")) throw new HttpError(401, "Session expired. Reopen the app from Claude Code or the CLI.");
      return send(res, 401, await page("locked.html"), MIME[".html"]);
    }

    if (req.method === "GET") {
      if (p === "/") {
        const ready = (await loadClient()) && (await loadTokens());
        return redirect(res, ready ? "/dashboard" : "/connect");
      }
      if (p === "/connect") return send(res, 200, await page("connect.html"), MIME[".html"]);
      if (p === "/dashboard") return send(res, 200, await page("dashboard.html"), MIME[".html"]);
      if (p === "/auth/start") return authStart(res, url.searchParams.get("hint") ?? undefined, url.searchParams.get("scopes") === "verify");
      if (p === "/api/state") return json(res, await state());
      if (p === "/api/sites") return json(res, { sites: isDemo ? demo.DEMO_SITES : await gsc.listSites() });
      if (p === "/api/project") {
        if (isDemo) return json(res, { siteUrl: demo.DEMO_SITES[0].siteUrl, ...demoProject });
        return json(res, (await loadProjectLink(projectDir)) ?? {});
      }
      if (p === "/api/telemetry") {
        return json(res, { consent: await telemetry.getConsent(), ...telemetry.telemetryInfo(), log: await telemetry.readLog() });
      }
      if (p === "/api/sitemaps") {
        const site = requireSite(url.searchParams.get("siteUrl"));
        return json(res, { sitemaps: isDemo ? demo.demoSitemaps(site) : await gsc.listSitemaps(site) });
      }
      throw new HttpError(404, "Not found");
    }

    if (req.method === "POST" && p.startsWith("/api/")) {
      if (!String(req.headers["content-type"]).startsWith("application/json")) {
        throw new HttpError(415, "Expected application/json");
      }
      const body = await readBody(req);
      if (isDemo) return demoPost(p, body, res);
      switch (p) {
        case "/api/client": {
          // Tokens belong to the client that issued them, so changing client means signing in again.
          if (body.useBuiltin === true) {
            if (!hasBuiltinClient()) throw new HttpError(400, "This version has no built-in sign-in client.");
            await removeClient();
            await clearTokens();
            return json(res, { ok: true });
          }
          const client =
            typeof body.json === "string" ? parseClientJson(body.json) : validateClient({ clientId: String(body.clientId ?? ""), clientSecret: String(body.clientSecret ?? "") });
          await saveClient(client);
          await clearTokens();
          return json(res, { ok: true });
        }
        case "/api/project-link": {
          const siteUrl = requireSite(body.siteUrl);
          const file = await saveProjectLink(projectDir, { siteUrl });
          return json(res, { ok: true, file });
        }
        case "/api/project/brand-terms": {
          const brandTerms = sanitizeTerms(body.brandTerms);
          await saveProjectLink(projectDir, { brandTerms });
          return json(res, { ok: true, brandTerms });
        }
        case "/api/project/annotations": {
          const link = await loadProjectLink(projectDir);
          const annotations = applyAnnotation(link?.annotations ?? [], body);
          await saveProjectLink(projectDir, { annotations });
          return json(res, { ok: true, annotations });
        }
        case "/api/finish": {
          const tokens = await loadTokens();
          const link = await loadProjectLink(projectDir);
          await telemetry.track("connect_completed", { linked_project: Boolean(link) });
          finish({ email: tokens?.email, siteUrl: link?.siteUrl, projectFile: link ? path.join(projectDir, ".gsc-connect.json") : undefined });
          return json(res, { ok: true });
        }
        case "/api/telemetry/consent": {
          if (body.consent !== "granted" && body.consent !== "denied") throw new HttpError(400, "consent must be granted or denied");
          await telemetry.setConsent(body.consent);
          // Recorded only for a "yes": a "no" sends nothing, not even itself.
          if (body.consent === "granted") await telemetry.track("consent_answered", { choice: "granted" });
          return json(res, { ok: true, consent: await telemetry.getConsent() });
        }
        case "/api/telemetry/event":
          await telemetry.track(requireString(body.name, "name"), (body.params ?? {}) as Record<string, unknown>);
          return json(res, { ok: true });
        case "/api/disconnect":
          await telemetry.track("disconnected");
          await revokeAndClear();
          return json(res, { ok: true });
        case "/api/analytics":
          return json(res, await analytics(body));
        case "/api/inspect":
          return json(res, await gsc.inspectUrl(requireSite(body.siteUrl), requireString(body.url, "url")));
        case "/api/sitemaps/submit":
          await gsc.submitSitemap(requireSite(body.siteUrl), requireString(body.feedpath, "feedpath"));
          return json(res, { ok: true });
      }
    }
    throw new HttpError(404, "Not found");
  }

  // Demo mode answers data routes with synthetic data and refuses anything
  // that would change local config or talk to Google.
  async function demoPost(p: string, body: Record<string, unknown>, res: http.ServerResponse) {
    switch (p) {
      case "/api/analytics":
        return json(res, await analytics(body));
      case "/api/inspect":
        return json(res, demo.demoInspect(requireSite(body.siteUrl), requireString(body.url, "url")));
      case "/api/project/brand-terms":
        demoProject.brandTerms = sanitizeTerms(body.brandTerms);
        return json(res, { ok: true, brandTerms: demoProject.brandTerms });
      case "/api/project/annotations":
        demoProject.annotations = applyAnnotation(demoProject.annotations, body);
        return json(res, { ok: true, annotations: demoProject.annotations });
      case "/api/sitemaps/submit":
      case "/api/telemetry/event":
        return json(res, { ok: true });
      default:
        throw new HttpError(403, "Not available in demo mode. Run `connect` to use your own Search Console data.");
    }
  }

  // queryType "branded" / "nonBranded" adds a query regex built from the project's brand terms.
  async function analytics(body: Record<string, unknown>) {
    const { siteUrl, queryType, ...request } = body;
    const req = sanitizeAnalytics(request);
    if (queryType === "branded" || queryType === "nonBranded") {
      const terms = isDemo ? demoProject.brandTerms : (await loadProjectLink(projectDir))?.brandTerms;
      const expression = brandRegex(terms);
      if (!expression) throw new HttpError(400, "Add brand terms in Settings to use the branded filter.");
      const filter = { dimension: "query" as const, operator: queryType === "branded" ? ("includingRegex" as const) : ("excludingRegex" as const), expression };
      req.dimensionFilterGroups = [{ groupType: "and", filters: [...(req.dimensionFilterGroups?.[0]?.filters ?? []), filter] }];
    }
    return gsc.searchAnalyticsFull(requireSite(siteUrl), req);
  }

  function hasSession(req: http.IncomingMessage): boolean {
    const cookies = Object.fromEntries(
      (req.headers.cookie ?? "").split(";").map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
      }),
    );
    const got = Buffer.from(cookies[COOKIE] ?? "");
    const want = Buffer.from(sessionId);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  async function state() {
    if (isDemo) {
      return { hasClient: true, clientSource: "builtin", builtinAvailable: true, builtinVerified: true, canVerifySites: true, clientIdHint: "demo", connected: true, email: "demo@example.com", projectDir, projectName: path.basename(projectDir), linkedSite: demo.DEMO_SITES[0].siteUrl, configDir: CONFIG_DIR_DISPLAY, telemetryConsent: "denied", version: VERSION, demo: true, redirectUri: `${origin}/oauth/callback` };
    }
    const { client, source } = await loadClientInfo();
    const tokens = await loadTokens();
    const link = await loadProjectLink(projectDir).catch(() => undefined);
    return {
      hasClient: Boolean(client),
      clientSource: source,
      builtinAvailable: hasBuiltinClient(),
      builtinVerified: BUILTIN_VERIFIED,
      canVerifySites: hasScope(tokens, VERIFY_SCOPE),
      clientIdHint: client && source !== "builtin" ? `${client.clientId.slice(0, 12)}…` : null,
      connected: Boolean(tokens),
      email: tokens?.email ?? null,
      projectDir,
      projectName: path.basename(projectDir),
      linkedSite: link?.siteUrl ?? null,
      configDir: CONFIG_DIR_DISPLAY,
      telemetryConsent: await telemetry.getConsent(),
      version: VERSION,
      updateAvailable,
      redirectUri: `${origin}/oauth/callback`,
    };
  }

  async function authStart(res: http.ServerResponse, hint?: string, verify = false) {
    const client = await loadClient();
    if (!client) return redirect(res, "/connect");
    pending = createAuthRequest(client, `${origin}/oauth/callback`, {
      loginHint: hint ?? (await loadTokens())?.email,
      extraScopes: verify ? [VERIFY_SCOPE] : [],
      returnTo: verify ? "verify" : undefined,
    });
    return redirect(res, pending.url);
  }

  async function oauthCallback(url: URL, res: http.ServerResponse) {
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const st = url.searchParams.get("state");
    if (error) return redirect(res, `/connect?error=${encodeURIComponent(error === "access_denied" ? "Sign-in was cancelled." : `Google returned: ${error}`)}`);
    if (!pending || !code || !st || st !== pending.state) {
      return redirect(res, `/connect?error=${encodeURIComponent("Sign-in link expired or was already used. Try again.")}`);
    }
    const auth = pending;
    pending = undefined;
    const client = await loadClient();
    if (!client) return redirect(res, "/connect");
    try {
      await exchangeCode(client, auth, code);
    } catch (err) {
      return redirect(res, `/connect?error=${encodeURIComponent((err as Error).message)}`);
    }
    return redirect(res, auth.returnTo === "verify" ? "/connect?upgraded=verify" : "/connect?signedIn=1");
  }

  async function serveAsset(p: string, res: http.ServerResponse) {
    const file = path.normalize(path.join(WEB_DIR, p));
    if (!file.startsWith(path.join(WEB_DIR, "assets"))) throw new HttpError(404, "Not found");
    const data = await fs.readFile(file).catch(() => {
      throw new HttpError(404, "Not found");
    });
    send(res, 200, data, MIME[path.extname(file)] ?? "application/octet-stream");
  }

  return {
    url: origin,
    port,
    launchUrl(pageName = "dashboard", upgrade) {
      const t = crypto.randomBytes(24).toString("base64url");
      launchTokens.add(t);
      setTimeout(() => launchTokens.delete(t), 10 * 60_000).unref();
      return `${origin}/launch?t=${t}&next=${pageName}${upgrade ? `&upgrade=${upgrade}` : ""}`;
    },
    waitForConnection(timeoutMs) {
      lastResult = undefined;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(done);
          reject(new Error("Timed out waiting for the Connect flow to finish."));
        }, timeoutMs);
        const done = (r: ConnectResult) => {
          clearTimeout(timer);
          resolve(r);
        };
        waiters.add(done);
      });
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function listen(server: http.Server, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port !== 0) return tryPort(0);
        reject(err);
      });
      server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    };
    tryPort(preferred);
  });
}

const pageCache = new Map<string, string>();
async function page(name: string): Promise<string> {
  if (!pageCache.has(name) || process.env.GSC_CONNECT_DEV) {
    pageCache.set(name, await fs.readFile(path.join(WEB_DIR, name), "utf8"));
  }
  return pageCache.get(name)!;
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https://www.google.com https://*.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(body);
}

const json = (res: http.ServerResponse, data: unknown) => send(res, 200, JSON.stringify(data), "application/json");

function redirect(res: http.ServerResponse, location: string) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${name} is required`);
  return v.trim();
}

function requireSite(v: unknown): string {
  const s = requireString(v, "siteUrl");
  if (!/^(sc-domain:[^/\s]+|https?:\/\/\S+\/)$/.test(s)) throw new HttpError(400, "siteUrl must be 'sc-domain:example.com' or 'https://example.com/'");
  return s;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSIONS = new Set(["date", "hour", "query", "page", "country", "device", "searchAppearance"]);
const FILTER_DIMS = new Set(["query", "page", "country", "device", "searchAppearance"]);
const OPERATORS = new Set(["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"]);

function isoDaysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function sanitizeTerms(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, "brandTerms must be a list");
  return [...new Set(v.map((t) => String(t).trim()).filter((t) => t && t.length <= 60))].slice(0, 30);
}

function applyAnnotation(list: Annotation[], body: Record<string, unknown>): Annotation[] {
  if (body.action === "remove") return list.filter((a) => !(a.date === body.date && a.text === body.text));
  const date = requireString(body.date, "date");
  const text = requireString(body.text, "text").slice(0, 120);
  if (!DATE.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD");
  return [...list, { date, text, source: "dashboard" as const }].sort((a, b) => a.date.localeCompare(b.date)).slice(-500);
}

function sanitizeAnalytics(r: Record<string, unknown>): gsc.SearchAnalyticsRequest {
  if (typeof r.startDate !== "string" || !DATE.test(r.startDate)) throw new HttpError(400, "startDate must be YYYY-MM-DD");
  if (typeof r.endDate !== "string" || !DATE.test(r.endDate)) throw new HttpError(400, "endDate must be YYYY-MM-DD");
  const dims = Array.isArray(r.dimensions) ? r.dimensions : [];
  if (!dims.every((d) => DIMENSIONS.has(d))) throw new HttpError(400, "Unknown dimension");
  const type = (gsc.SEARCH_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as gsc.SearchType) : "web";
  const filters = Array.isArray(r.filters) ? r.filters : [];
  for (const f of filters) {
    if (!FILTER_DIMS.has(f?.dimension) || !OPERATORS.has(f?.operator) || typeof f?.expression !== "string" || f.expression.length > 4096) {
      throw new HttpError(400, "Invalid filter");
    }
  }
  return {
    startDate: r.startDate,
    endDate: r.endDate,
    dimensions: dims as gsc.Dimension[],
    type,
    dimensionFilterGroups: filters.length ? [{ groupType: "and", filters }] : undefined,
    rowLimit: Math.min(Math.max(Number(r.rowLimit ?? 1000), 1), 25000),
    startRow: Math.max(Number(r.startRow ?? 0), 0),
    dataState: r.dataState === "final" ? "final" : r.dataState === "hourly_all" || dims.includes("hour") ? "hourly_all" : "all",
  };
}
