// Google OAuth 2.0 for installed apps: loopback redirect + PKCE (RFC 7636).
// https://developers.google.com/identity/protocols/oauth2/native-app
import crypto from "node:crypto";
import {
  type ClientCredentials,
  type StoredTokens,
  clearTokens,
  loadClient,
  loadTokens,
  saveTokens,
} from "./store.js";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

// Asked at sign-in: read/write Search Console (reports, sitemaps, adding
// properties) and the email address, to show which account is connected.
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters"];

// Asked only the first time someone verifies a new site (incremental auth).
export const VERIFY_SCOPE = "https://www.googleapis.com/auth/siteverification";

export function hasScope(tokens: StoredTokens | undefined, scope: string): boolean {
  return Boolean(tokens?.scope?.split(" ").includes(scope));
}

export class NotConnectedError extends Error {
  constructor(message = "Not connected to Google Search Console. Run the gsc_connect tool (or `npx google-search-console-connector connect`) first.") {
    super(message);
  }
}

const base64url = (buf: Buffer) => buf.toString("base64url");

export interface PendingAuth {
  url: string;
  state: string;
  verifier: string;
  redirectUri: string;
  /** Where the Connect page goes after Google sends the user back. */
  returnTo?: "verify";
}

export function createAuthRequest(
  client: ClientCredentials,
  redirectUri: string,
  opts: { loginHint?: string; extraScopes?: string[]; returnTo?: "verify" } = {},
): PendingAuth {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(24));
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [...SCOPES, ...(opts.extraScopes ?? [])].join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    // Always show consent so Google re-issues a refresh token.
    prompt: "consent select_account",
    include_granted_scopes: "true",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return { url: `${AUTH_ENDPOINT}?${params}`, state, verifier, redirectUri, returnTo: opts.returnTo };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    const err = new Error(
      `Google token endpoint: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim(),
    );
    (err as Error & { code?: string }).code = json.error;
    throw err;
  }
  return json;
}

// The id_token comes straight from Google's token endpoint over TLS, and is
// only used to display which account is connected.
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeCode(
  client: ClientCredentials,
  pending: PendingAuth,
  code: string,
): Promise<StoredTokens> {
  const json = await postToken({
    grant_type: "authorization_code",
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  if (!json.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and connect again.");
  }
  const tokens: StoredTokens = {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
    email: emailFromIdToken(json.id_token),
  };
  await saveTokens(tokens);
  return tokens;
}

let refreshing: Promise<string> | undefined;

/** Returns a valid access token, refreshing it when it is about to expire. */
export async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new NotConnectedError();
  if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt - Date.now() > 60_000) {
    return tokens.accessToken;
  }
  refreshing ??= (async () => {
    const client = await loadClient();
    if (!client) throw new NotConnectedError("Google OAuth client is not configured. Run gsc_connect.");
    try {
      const json = await postToken({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      });
      await saveTokens({
        ...tokens,
        accessToken: json.access_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        refreshToken: json.refresh_token ?? tokens.refreshToken,
      });
      return json.access_token;
    } catch (err) {
      if ((err as Error & { code?: string }).code === "invalid_grant") {
        await clearTokens();
        throw new NotConnectedError(
          "Google access was revoked or expired (apps left in 'Testing' mode expire refresh tokens after 7 days). Run gsc_connect to sign in again.",
        );
      }
      throw err;
    }
  })().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

export async function revokeAndClear(): Promise<void> {
  const tokens = await loadTokens();
  if (tokens?.refreshToken) {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }),
    }).catch(() => undefined);
  }
  await clearTokens();
}
