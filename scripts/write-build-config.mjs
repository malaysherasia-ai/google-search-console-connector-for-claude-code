#!/usr/bin/env node
// Writes the build-time config that ships in the npm package but is never
// committed to git:
//  - dist/ga-config.json from GA_API_SECRET (GA4 Measurement Protocol secret).
//    Without it, usage metrics stay local-only.
//  - dist/builtin-client.json from GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET,
//    or else the gitignored .oauth-client.json. Without it, users bring their
//    own OAuth client.
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

async function write(name, data) {
  await fs.mkdir(dist, { recursive: true });
  await fs.writeFile(path.join(dist, name), JSON.stringify(data) + "\n");
  console.log(`Wrote dist/${name}`);
}

const gaSecret = process.env.GA_API_SECRET?.trim();
if (gaSecret) await write("ga-config.json", { apiSecret: gaSecret });
else console.log("GA_API_SECRET not set: usage metrics will be logged locally but not sent.");

let client = { clientId: process.env.GSC_OAUTH_CLIENT_ID?.trim(), clientSecret: process.env.GSC_OAUTH_CLIENT_SECRET?.trim() };
const localFile = path.join(root, ".oauth-client.json");
if (!(client.clientId && client.clientSecret) && existsSync(localFile)) {
  client = JSON.parse(await fs.readFile(localFile, "utf8"));
}
if (client.clientId && client.clientSecret) {
  await write("builtin-client.json", { clientId: client.clientId, clientSecret: client.clientSecret });
} else {
  await fs.rm(path.join(dist, "builtin-client.json"), { force: true });
  console.log("No OAuth client (GSC_OAUTH_CLIENT_ID/SECRET or .oauth-client.json): users bring their own.");
}
