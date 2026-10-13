# State

**Current phase**: 1–4 built and checked with sample data; Phase 5 (packaging) prepared
**Status**: Live sign-in verified; next: first npm publish, then Google sensitive-scope verification
**Last updated**: 2026-10-13

## Verified (demo mode)
- MCP server: all 18 tools over stdio
- Report export: CSV/JSON/summary, .gitignore entry
- Dashboard: every view at 1440px, 520px, light and dark; hourly view
- Connect flow: consent, Google Cloud setup, sign-in screens

## Verified live (2026-10-13)
- Built-in OAuth client (Google Cloud project "Search Console Connector"): one-click sign-in, property picker, dashboard
- Real API: performance summary, sitemaps, URL inspection, list sites
- Brand verification approved; app published (In production); claude-repo.com verified in Search Console

## Not yet verified
- Sensitive-scope verification (webmasters, siteverification) not submitted: needs demo video
- siteverification incremental consent with a real site
- GA4 delivery (needs measurement ID + API secret in src/telemetry.ts)

## Decisions log
- 2026-10-08: GSD adopted mid-build; .planning/ tracks requirements.
- 2026-10-08: never-again installed; L001 (scripted edits), L002 (fill() hook).
- 2026-10-08: All Google usage on the user's own Cloud project (LOCKED).
- 2026-10-08: Usage metrics opt-in via GA4 Measurement Protocol, allowlisted events, local log.
- 2026-10-08: Releases are driven by the Google watcher + opt-in usage (RELEASING.md).
- 2026-10-13: Built-in OAuth client injected at build time (.oauth-client.json / env, gitignored), never committed; GitHub installs use bring-your-own client.

## Blockers
- Owner to create the GA4 property and Measurement Protocol secret.
