# State

**Current phase**: 1–4 built and checked with sample data; Phase 5 (packaging) prepared
**Status**: Ready for live verification with a real Google OAuth client, then publish
**Last updated**: 2026-10-08

## Verified (demo mode)
- MCP server: all 18 tools over stdio
- Report export: CSV/JSON/summary, .gitignore entry
- Dashboard: every view at 1440px, 520px, light and dark; hourly view
- Connect flow: consent, Google Cloud setup, sign-in screens

## Not yet verified
- Live Google sign-in round trip and real API responses (needs owner's OAuth client)
- GA4 delivery (needs measurement ID + API secret in src/telemetry.ts)

## Decisions log
- 2026-10-08: GSD adopted mid-build; .planning/ tracks requirements.
- 2026-10-08: never-again installed; L001 (scripted edits), L002 (fill() hook).
- 2026-10-08: All Google usage on the user's own Cloud project (LOCKED).
- 2026-10-08: Usage metrics opt-in via GA4 Measurement Protocol, allowlisted events, local log.
- 2026-10-08: Releases are driven by the Google watcher + opt-in usage (RELEASING.md).

## Blockers
- Owner to create the GA4 property and Measurement Protocol secret.
