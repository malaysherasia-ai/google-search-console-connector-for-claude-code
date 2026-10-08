#!/usr/bin/env node
// Writes dist/ga-config.json from GA_API_SECRET so the GA4 Measurement Protocol
// secret ships in the npm package without ever being committed to git.
// Without GA_API_SECRET it writes nothing, and usage metrics stay local-only.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secret = process.env.GA_API_SECRET?.trim();
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "ga-config.json");

if (!secret) {
  console.log("GA_API_SECRET not set: usage metrics will be logged locally but not sent.");
} else {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify({ apiSecret: secret }) + "\n");
  console.log("Wrote dist/ga-config.json");
}
