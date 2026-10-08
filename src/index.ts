#!/usr/bin/env node
// CLI entry. With no arguments (how Claude Code launches it) it runs the MCP
// server on stdio; subcommands are for humans in a terminal.
import open from "open";
import path from "node:path";
import { startAppServer } from "./app-server.js";
import * as gsc from "./gsc.js";
import { ensureGitignored, exportReport } from "./report.js";
import { track } from "./telemetry.js";
import { latestVersion, updateCommand } from "./update-check.js";
import { runMcpServer } from "./mcp.js";
import { revokeAndClear } from "./oauth.js";
import { CONFIG_DIR, loadClient, loadProjectLink, loadTokens } from "./store.js";
import { VERSION } from "./version.js";

const HELP = `google-search-console-connector ${VERSION}

Usage:
  google-search-console-connector              Run the MCP server (used by Claude Code)
  google-search-console-connector connect      Set up Google and link this project, in the browser
  google-search-console-connector dashboard    Open the local Search Console dashboard
  google-search-console-connector demo         Try the dashboard with sample data (no Google account needed)
  google-search-console-connector report       Download Search Console reports (CSV + summary) into .gsc-reports/
      --days 28        Period length (1-485), compared with the previous period
      --type web       web | image | video | news | discover | googleNews
      --site URL       Property (default: this project's linked property)
      --all-sites      Every property you have access to
      --out DIR        Output folder (default: .gsc-reports)
  google-search-console-connector status       Show connection status
  google-search-console-connector logout       Revoke and delete the stored Google token

Add to Claude Code:
  claude mcp add gsc --scope user -- npx -y google-search-console-connector
`;

async function serveUi(page: "connect" | "dashboard", demo = false) {
  const app = await startAppServer(process.cwd(), { demo });
  const url = app.launchUrl(page);
  console.log(`Opening ${app.url}/${page}`);
  console.log(`If no browser window appears, open this one-time link:\n  ${url}\n`);
  if (!process.env.GSC_CONNECT_NO_OPEN) await open(url).catch(() => undefined);
  if (page === "connect") {
    const r = await app.waitForConnection(30 * 60_000);
    console.log(`Connected${r.email ? ` as ${r.email}` : ""}.${r.siteUrl ? ` Project linked to ${r.siteUrl}.` : ""}`);
    console.log("The dashboard stays available here. Press Ctrl+C to stop.");
  } else {
    console.log("Press Ctrl+C to stop.");
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function runReport(args: string[]) {
  const projectDir = process.cwd();
  const days = Number(flag(args, "days") ?? 28);
  const type = (flag(args, "type") ?? "web") as gsc.SearchType;
  if (!gsc.SEARCH_TYPES.includes(type)) throw new Error(`--type must be one of ${gsc.SEARCH_TYPES.join(", ")}`);
  const outRel = flag(args, "out") ?? ".gsc-reports";
  const outDir = path.resolve(projectDir, outRel);
  const link = await loadProjectLink(projectDir);
  let sites: string[];
  if (args.includes("--all-sites")) {
    sites = (await gsc.listSites()).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
  } else {
    const site = flag(args, "site") ?? link?.siteUrl;
    if (!site) throw new Error("This project isn't linked to a property. Pass --site, --all-sites, or run `connect` first.");
    sites = [site];
  }
  for (const siteUrl of sites) {
    process.stdout.write(`Exporting ${siteUrl} (${days} days, ${type})... `);
    const r = await exportReport({ siteUrl, days, type, outDir, brandTerms: siteUrl === link?.siteUrl ? link?.brandTerms : undefined });
    console.log(`done\n  ${path.relative(projectDir, r.dir) || r.dir}${path.sep}  (${r.files.length} files, start with summary.md)`);
  }
  await track("report_exported", { days, search_type: type, site_count: sites.length, source: "cli" });
  const rel = path.relative(projectDir, outDir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel) && (await ensureGitignored(projectDir, rel))) {
    console.log(`Added ${rel}/ to .gitignore so Search Console data isn't committed or deployed.`);
  }
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case undefined:
    case "mcp":
      return runMcpServer();
    case "connect":
    case "dashboard":
      return serveUi(cmd);
    case "demo":
      return serveUi("dashboard", true);
    case "report":
      return runReport(process.argv.slice(3));
    case "status": {
      const [client, tokens, link] = await Promise.all([loadClient(), loadTokens(), loadProjectLink(process.cwd())]);
      console.log(`Config dir:     ${CONFIG_DIR}`);
      console.log(`OAuth client:   ${client ? "configured" : "missing (run connect)"}`);
      console.log(`Google account: ${tokens ? (tokens.email ?? "connected") : "not connected"}`);
      console.log(`This project:   ${link?.siteUrl ?? "not linked"}`);
      return;
    }
    case "logout":
      await revokeAndClear();
      console.log("Disconnected.");
      return;
    case "-v":
    case "--version":
      console.log(VERSION);
      return;
    default:
      console.log(HELP);
      process.exitCode = cmd === "help" || cmd === "--help" || cmd === "-h" ? 0 : 1;
  }
}

async function notifyUpdate() {
  const v = await latestVersion();
  if (v) console.log(`
Version ${v} is available (you have ${VERSION}). Run: ${updateCommand} ${process.argv[2] ?? ""}`.trimEnd());
}

main()
  .then(() => (process.argv[2] && process.argv[2] !== "mcp" ? notifyUpdate() : undefined))
  .catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
