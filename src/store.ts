// Local persistence: OAuth client credentials and tokens live in the user's
// home directory (never in a project), per-project property links live in the
// project directory as .gsc-connect.json (safe to commit: no secrets).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILTIN_CLIENT, hasBuiltinClient } from "./builtin-client.js";

export const CONFIG_DIR =
  process.env.GSC_CONNECT_HOME ?? path.join(os.homedir(), ".gsc-connect");
const CLIENT_FILE = path.join(CONFIG_DIR, "client.json");
const TOKEN_FILE = path.join(CONFIG_DIR, "tokens.json");
export const PROJECT_FILE = ".gsc-connect.json";

/** CONFIG_DIR for display, with the home folder shown as ~. */
export const CONFIG_DIR_DISPLAY = (() => {
  const dir = path.resolve(CONFIG_DIR);
  const home = path.resolve(os.homedir());
  return dir.toLowerCase().startsWith(home.toLowerCase()) ? `~${dir.slice(home.length).split(path.sep).join("/")}` : dir;
})();

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
  email?: string;
}

export interface Annotation {
  date: string; // YYYY-MM-DD
  text: string;
  source?: "claude" | "dashboard";
}

export interface ProjectLink {
  siteUrl: string;
  /** Words that mark a query as branded, e.g. the business name. */
  brandTerms?: string[];
  /** Notes shown on the performance chart, e.g. "Rewrote title tags". */
  annotations?: Annotation[];
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function writePrivateJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

export type ClientSource = "environment" | "own" | "builtin";

/** Which OAuth client to use: environment variables, then the user's own client, then the built-in one. */
export async function loadClientInfo(): Promise<{ client?: ClientCredentials; source: ClientSource | null }> {
  const id = process.env.GSC_CLIENT_ID;
  const secret = process.env.GSC_CLIENT_SECRET;
  if (id && secret) return { client: { clientId: id, clientSecret: secret }, source: "environment" };
  const own = await readJson<ClientCredentials>(CLIENT_FILE);
  if (own) return { client: own, source: "own" };
  if (hasBuiltinClient()) return { client: { ...BUILTIN_CLIENT }, source: "builtin" };
  return { source: null };
}

export async function loadClient(): Promise<ClientCredentials | undefined> {
  return (await loadClientInfo()).client;
}

/** Forget the user's own client so the built-in one is used again. */
export async function removeClient(): Promise<void> {
  await fs.rm(CLIENT_FILE, { force: true });
}

export async function saveClient(client: ClientCredentials): Promise<void> {
  await writePrivateJson(CLIENT_FILE, client);
}

/**
 * Accepts either the client_secret_*.json downloaded from Google Cloud Console
 * ({"installed": {...}} or {"web": {...}}) or a bare {client_id, client_secret}.
 */
export function parseClientJson(raw: string): ClientCredentials {
  const parsed = JSON.parse(raw);
  const body = parsed.installed ?? parsed.web ?? parsed;
  const clientId = body.client_id ?? body.clientId;
  const clientSecret = body.client_secret ?? body.clientSecret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new Error("JSON does not contain client_id and client_secret");
  }
  return validateClient({ clientId, clientSecret });
}

export function validateClient(c: ClientCredentials): ClientCredentials {
  const clientId = c.clientId.trim();
  const clientSecret = c.clientSecret.trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error("Client ID should end in .apps.googleusercontent.com");
  }
  if (!clientSecret) throw new Error("Client secret is required");
  return { clientId, clientSecret };
}

export async function loadTokens(): Promise<StoredTokens | undefined> {
  return readJson<StoredTokens>(TOKEN_FILE);
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await writePrivateJson(TOKEN_FILE, tokens);
}

export async function clearTokens(): Promise<void> {
  await fs.rm(TOKEN_FILE, { force: true });
}

export async function loadProjectLink(
  projectDir: string,
): Promise<ProjectLink | undefined> {
  return readJson<ProjectLink>(path.join(projectDir, PROJECT_FILE));
}

/** Merges into the existing project file so brand terms and notes survive a property change. */
export async function saveProjectLink(
  projectDir: string,
  patch: Partial<ProjectLink>,
): Promise<string> {
  const file = path.join(projectDir, PROJECT_FILE);
  const next = { ...(await loadProjectLink(projectDir)), ...patch };
  if (!next.siteUrl) throw new Error("Link a Search Console property to this project first (gsc_link_project).");
  await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n");
  return file;
}

/** Case-insensitive RE2 pattern (what Search Console filters use) matching any brand term. */
export function brandRegex(terms: string[] = []): string | undefined {
  const clean = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!clean.length) return undefined;
  return `(?i)(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
}
