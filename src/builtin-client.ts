// The connector's own Google OAuth client (type "Desktop app"), so users can
// just click "Sign in with Google" without creating a Google Cloud project.
//
// For installed apps Google states the client secret "is obviously not treated
// as a secret" (https://developers.google.com/identity/protocols/oauth2#installed):
// it ships inside every copy of the app. Sign-in is still protected by PKCE and
// the loopback redirect, and tokens never leave the user's computer.
//
// It is still kept out of git: `npm run build` writes dist/builtin-client.json
// from GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET or the gitignored
// .oauth-client.json (scripts/write-build-config.mjs). Builds without it, such
// as installs straight from GitHub, ask users to bring their own client.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function bundledClient(): { clientId: string; clientSecret: string } {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin-client.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    return { clientId: String(json.clientId ?? ""), clientSecret: String(json.clientSecret ?? "") };
  } catch {
    return { clientId: "", clientSecret: "" };
  }
}

export const BUILTIN_CLIENT = bundledClient();

/** Set to true once Google has verified the app's OAuth consent screen. */
export const BUILTIN_VERIFIED = false;

export const hasBuiltinClient = () => BUILTIN_CLIENT.clientId.length > 0 && BUILTIN_CLIENT.clientSecret.length > 0;
