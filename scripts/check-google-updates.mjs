#!/usr/bin/env node
// Watches Google for changes that should shape the next release:
//  1. The Search Console + Site Verification API discovery documents (the
//     machine-readable API definitions): new dimensions, enums, fields,
//     methods or parameters show up here before anywhere else.
//  2. The Google Search Central blog: posts about Search Console.
//
// Usage:
//   node scripts/check-google-updates.mjs            report changes vs snapshot (exit 0)
//   node scripts/check-google-updates.mjs --update   also rewrite the snapshot
//   node scripts/check-google-updates.mjs --report out.md   write the Markdown report to a file
//
// Exit code is 0 either way; CI reads `changes=true|false` from GITHUB_OUTPUT.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = path.join(ROOT, "google-api", "snapshot.json");

const APIS = {
  searchconsole: "https://searchconsole.googleapis.com/$discovery/rest?version=v1",
  siteVerification: "https://www.googleapis.com/discovery/v1/apis/siteVerification/v1/rest",
};
const FEED = "https://developers.google.com/static/search/blog/feed.xml";
const FEED_MATCH = /search console|searchconsole|search analytics|url inspection|sitemap|performance report|indexing/i;

const args = process.argv.slice(2);
const update = args.includes("--update");
const reportFile = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;

async function get(url, as = "json") {
  const res = await fetch(url, { headers: { "User-Agent": "google-search-console-connector update check" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

/** Reduce a discovery doc to its API surface: what a client can send and get back. */
function surface(doc) {
  const out = {};
  for (const [name, schema] of Object.entries(doc.schemas ?? {})) {
    for (const [prop, def] of Object.entries(schema.properties ?? {})) {
      const t = def.$ref ? `ref:${def.$ref}` : def.type === "array" ? `array<${def.items?.$ref ?? def.items?.type}>` : def.type;
      const en = def.enum ?? def.items?.enum;
      out[`schema ${name}.${prop}`] = en ? `${t} enum[${en.join(",")}]` : t;
    }
  }
  const walk = (resources, prefix) => {
    for (const [rname, r] of Object.entries(resources ?? {})) {
      for (const [mname, m] of Object.entries(r.methods ?? {})) {
        out[`method ${prefix}${rname}.${mname}`] = `${m.httpMethod} ${m.flatPath ?? m.path}`;
        for (const [pname, p] of Object.entries(m.parameters ?? {})) {
          out[`param ${prefix}${rname}.${mname}(${pname})`] = p.enum ? `${p.type} enum[${p.enum.join(",")}]` : p.type;
        }
      }
      walk(r.resources, `${prefix}${rname}.`);
    }
  };
  walk(doc.resources, "");
  for (const [scope] of Object.entries(doc.auth?.oauth2?.scopes ?? {})) out[`scope ${scope}`] = "present";
  return out;
}

function diff(before = {}, after = {}) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const k of Object.keys(after)) {
    if (!(k in before)) added.push(`${k}: ${after[k]}`);
    else if (before[k] !== after[k]) changed.push(`${k}: ${before[k]} → ${after[k]}`);
  }
  for (const k of Object.keys(before)) if (!(k in after)) removed.push(`${k}: ${before[k]}`);
  return { added, removed, changed };
}

function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => (m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
    items.push({ guid: pick("guid"), title: pick("title"), link: pick("link"), date: pick("pubDate"), summary: pick("description") });
  }
  return items;
}

const snapshot = JSON.parse(await fs.readFile(SNAPSHOT, "utf8").catch(() => "{}"));
const next = { apis: {}, revisions: {}, seenPosts: snapshot.seenPosts ?? [], checkedAt: new Date().toISOString() };
const lines = [];
let changes = false;

for (const [name, url] of Object.entries(APIS)) {
  const doc = await get(url);
  next.apis[name] = surface(doc);
  next.revisions[name] = doc.revision;
  const d = diff(snapshot.apis?.[name], next.apis[name]);
  const n = d.added.length + d.removed.length + d.changed.length;
  if (!snapshot.apis?.[name]) {
    lines.push(`- **${name}**: baseline recorded (revision ${doc.revision}).`);
    continue;
  }
  if (!n) continue;
  changes = true;
  lines.push(`### ${name} API (revision ${snapshot.revisions?.[name]} → ${doc.revision})`, "");
  for (const a of d.added) lines.push(`- Added \`${a}\``);
  for (const c of d.changed) lines.push(`- Changed \`${c}\``);
  for (const r of d.removed) lines.push(`- **Removed** \`${r}\``);
  lines.push("");
}

const posts = parseFeed(await get(FEED, "text")).filter((p) => FEED_MATCH.test(`${p.title} ${p.summary}`));
const fresh = posts.filter((p) => !next.seenPosts.includes(p.guid));
if (fresh.length && snapshot.seenPosts) {
  changes = true;
  lines.push("### Search Central blog posts about Search Console", "");
  for (const p of fresh) lines.push(`- [${p.title}](${p.link}) (${new Date(p.date).toISOString().slice(0, 10)})`);
  lines.push("");
}
next.seenPosts = [...new Set([...next.seenPosts, ...posts.map((p) => p.guid)])].slice(-200);

const report = changes
  ? ["## Google Search Console changes detected", "", ...lines, "Review each item: support it in `src/gsc.ts`, the MCP tools (`src/mcp.ts`) and the dashboard, or note why not. See RELEASING.md."].join("\n")
  : `No changes to the Search Console APIs or new Search Console posts since ${snapshot.checkedAt ?? "the last check"}.${lines.length ? `\n\n${lines.join("\n")}` : ""}`;

console.log(report);
if (reportFile) await fs.writeFile(reportFile, report + "\n");
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `changes=${changes}\n`);
if (update || !snapshot.apis) {
  await fs.mkdir(path.dirname(SNAPSHOT), { recursive: true });
  await fs.writeFile(SNAPSHOT, JSON.stringify(next, null, 2) + "\n");
}
