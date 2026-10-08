// Opt-in, anonymous usage metrics sent to GA4 via the Measurement Protocol.
//
// Guarantees (also stated on the consent screen and in README "Privacy"):
//  - Nothing is sent until the user explicitly answers "Yes". "No" or no
//    answer means no network calls at all.
//  - DO_NOT_TRACK=1 or GSC_CONNECT_TELEMETRY=0 force it off.
//  - Only allowlisted event names and parameters leave the machine. Never
//    property URLs, page URLs, queries, emails, tokens or metric values.
//  - Every event sent is also written to a local log the user can view in
//    Settings ("What's been sent") or at ~/.gsc-connect/telemetry-log.jsonl.
//  - Events go from this local process to Google; no tracking script runs in
//    the browser and no cookies are set.
import crypto from "node:crypto";
import { readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR } from "./store.js";
import { VERSION } from "./version.js";

// GA4 property owned by the project maintainer. The Measurement Protocol API
// secret is kept out of git: `npm run build` writes dist/ga-config.json from
// the GA_API_SECRET environment variable when publishing (scripts/write-ga-config.mjs).
// It only allows sending events, never reading data.
function bundledSecret(): string {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "ga-config.json");
    return String(JSON.parse(readFileSync(file, "utf8")).apiSecret ?? "");
  } catch {
    return "";
  }
}
const MEASUREMENT_ID = process.env.GSC_CONNECT_GA_ID ?? "G-TC1ZF78VKL";
const API_SECRET = process.env.GSC_CONNECT_GA_SECRET ?? bundledSecret();

const FILE = path.join(CONFIG_DIR, "telemetry.json");
const LOG = path.join(CONFIG_DIR, "telemetry-log.jsonl");
const LOG_MAX = 200;

export type Consent = "granted" | "denied" | null;

interface TelemetryFile {
  consent: Exclude<Consent, null>;
  decidedAt: string;
  clientId: string;
}

/** Event name -> allowed parameter names. Anything else is dropped. */
export const EVENTS: Record<string, string[]> = {
  page_view: ["page_title"],
  consent_answered: ["choice"],
  connect_step: ["step"],
  connect_completed: ["linked_project"],
  view_changed: ["view"],
  range_changed: ["range"],
  search_type_changed: ["search_type"],
  metric_selected: ["metric"],
  query_type_changed: ["query_type"],
  chart_grouped: ["grain"],
  note_added: [],
  report_exported: ["days", "search_type", "site_count", "source"],
  table_sorted: ["table", "column"],
  table_searched: ["table"],
  rows_expanded: ["table"],
  export_csv: ["table"],
  url_inspected: ["verdict"],
  sitemap_submitted: [],
  property_switched: [],
  theme_toggled: ["theme"],
  disconnected: [],
  dashboard_error: ["area"],
  mcp_tool_called: ["tool", "ok"],
};

export function forcedOff(): boolean {
  return process.env.DO_NOT_TRACK === "1" || process.env.GSC_CONNECT_TELEMETRY === "0";
}

export function isConfigured(): boolean {
  return /^G-[A-Z0-9]{6,}$/.test(MEASUREMENT_ID) && MEASUREMENT_ID !== "G-XXXXXXXXXX" && API_SECRET.length > 0;
}

async function read(): Promise<TelemetryFile | undefined> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return undefined;
  }
}

export async function getConsent(): Promise<Consent> {
  if (forcedOff()) return "denied";
  return (await read())?.consent ?? null;
}

export async function setConsent(consent: "granted" | "denied"): Promise<void> {
  const prev = await read();
  const data: TelemetryFile = {
    consent,
    decidedAt: new Date().toISOString(),
    // A random id with no link to the person, rotated whenever consent changes.
    clientId: prev?.consent === consent ? prev.clientId : crypto.randomUUID(),
  };
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (consent === "denied") await fs.rm(LOG, { force: true });
}

export async function readLog(limit = 50): Promise<unknown[]> {
  try {
    const lines = (await fs.readFile(LOG, "utf8")).trim().split("\n").filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function appendLog(entry: unknown) {
  let lines: string[] = [];
  try {
    lines = (await fs.readFile(LOG, "utf8")).trim().split("\n").filter(Boolean);
  } catch {}
  lines.push(JSON.stringify(entry));
  await fs.writeFile(LOG, lines.slice(-LOG_MAX).join("\n") + "\n", { mode: 0o600 });
}

function clean(name: string, params: Record<string, unknown> = {}): Record<string, string | number> | undefined {
  const allowed = EVENTS[name];
  if (!allowed) return undefined;
  const out: Record<string, string | number> = {};
  for (const key of allowed) {
    const v = params[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v ? 1 : 0;
    // Short identifier-like strings only: a stray URL or free text cannot pass.
    else if (typeof v === "string" && /^[\w-]{1,40}$/.test(v)) out[key] = v;
  }
  return out;
}

// One session per process start, which is how GA4 groups engagement.
const sessionId = String(Math.floor(Date.now() / 1000));

export async function track(name: string, params?: Record<string, unknown>): Promise<void> {
  try {
    if (forcedOff()) return;
    const file = await read();
    if (file?.consent !== "granted") return;
    const p = clean(name, params);
    if (!p) return;
    const event = {
      name,
      params: {
        ...p,
        app_version: VERSION,
        os: process.platform,
        node_major: Number(process.versions.node.split(".")[0]),
        session_id: sessionId,
        engagement_time_msec: 100,
      },
    };
    const configured = isConfigured();
    await appendLog({ at: new Date().toISOString(), sent: configured, event });
    if (!configured) return;
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(API_SECRET)}`;
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({ client_id: file.clientId, non_personalized_ads: true, events: [event] }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Metrics must never break the tool.
  }
}

export const telemetryInfo = () => ({
  measurementId: isConfigured() ? MEASUREMENT_ID : null,
  forcedOff: forcedOff(),
  logFile: LOG,
  events: EVENTS,
});
