# Google Search Console Connector

## What This Is

An open-source connector that links any website project built with Claude Code
to its Google Search Console (GSC) property. A local browser flow walks the
user through Google Cloud setup and Google sign-in (OAuth 2.0, PKCE), then
Claude Code gets GSC tools over MCP and the user gets a local SaaS-grade
dashboard of the latest GSC metrics.

Published at claude-repo.com/google-search-console-connector and on the
owner's personal GitHub.

## Core Value

From a fresh website repo to "Claude can read and act on this site's Search
Console data" in under five minutes, with Google's own auth and no
third-party server holding anyone's tokens.

## Requirements

### Validated

(None yet: ship to validate)

### Active

- [ ] Browser-based Connect flow: Google Cloud setup guide, OAuth sign-in, property picker
- [ ] MCP server exposing GSC to Claude Code (performance, inspection, sitemaps, add + verify sites)
- [ ] Per-project link file so each website repo knows its property
- [ ] Local dashboard: KPIs vs previous period, trend, queries, pages, countries, devices, opportunities, indexing
- [ ] Professional SaaS-quality UI (Semrush-class polish), light + dark
- [ ] One-command install into Claude Code

### Out of Scope

- Hosted/multi-tenant service: tokens never leave the user's machine
- Shipping a shared Google OAuth client: unverified sensitive-scope apps cap at 100 users; each user brings their own Desktop client
- GA4, Bing, rank tracking: separate connectors

## Context

- Built for agencies and developers who ship many client sites with Claude Code or Antigravity.
- Google requires a Google Cloud project with the Search Console API and Site Verification API enabled, plus an OAuth client of type "Desktop app".
- Apps left in "Testing" publishing status get refresh tokens that expire after 7 days.

## Constraints

- **Runtime**: Node.js >= 20, TypeScript, minimal deps (MCP SDK, zod, open)
- **Security**: loopback-only server, session cookie, Host check, PKCE + state, tokens stored 0600 in ~/.gsc-connect
- **Cost**: maintainer bears no per-user cost; all API usage on the user's own Google Cloud project
- **Offline-friendly UI**: no chart/CSS libraries from CDNs; system-font fallback

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MCP server over a site-embedded widget | GSC access belongs to the Google account, not the website; Claude Code consumes MCP natively | Pending |
| Bring-your-own OAuth client (LOCKED) | Every Google API call runs on the user's own Google Cloud project, so quota and any cost are theirs; maintainer pays nothing. Also avoids Google verification + 100-user cap | Pending |
| Zero maintainer infrastructure (LOCKED) | No hosted server, no shared keys, no Anthropic API calls; only the opt-in GA4 metrics reach a maintainer account (free tier) | Pending |
| Raw fetch instead of googleapis | ~100 MB smaller, auditable | Pending |
| Hand-rolled SVG charts | No CDN dependency, offline, one-axis rule | Pending |

---
*Last updated: 2026-10-08 after initialization*
