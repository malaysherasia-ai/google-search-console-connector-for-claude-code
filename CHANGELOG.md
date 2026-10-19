# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.3 (2026-10-19)

- Sign-in no longer half-succeeds when the Search Console box on Google's consent screen is left unticked: the connector keeps your existing sign-in and asks you to sign in again and tick the box
- The Connect page tells you to tick that box before you go to Google

## 0.1.2 (2026-10-19)

- Connect page always shows which Google account is signed in, with a "Use a different account" link
- No more "Google may say this app isn't verified" note: the app's branding is verified and every permission it asks for is non-sensitive, so Google shows no warning

## 0.1.1 (2026-10-19)

- Listed on the official MCP Registry as `io.github.malaysherasia-ai/google-search-console-connector` (`mcpName` in package.json, `server.json`)
- Demo GIF at the top of the README (`docs/demo.gif`; `docs/demo.mp4` for social posts)
- Package description no longer says you need your own Google Cloud project

## 0.1.0 (2026-10-19)

First release.

- One-click Google sign-in (built-in OAuth client; own Google Cloud project optional), site-verification permission requested only when needed
- claude-repo.com brand: dark theme by default, Inter and JetBrains Mono self-hosted (no Google Fonts requests), gsc-connector wordmark, chain-link icon
- Privacy policy and Google verification guide in docs/
- Built-in OAuth client is added at build time (`dist/builtin-client.json`) and never committed; installs from GitHub use your own client
- `gsc_list_sitemaps` no longer returns Google's deprecated, always-zero `indexed` count

- Browser Connect flow: Google Cloud OAuth client setup, Google sign-in (loopback + PKCE), property picker per project
- MCP server with 18 tools for Claude Code, Antigravity and other MCP clients
- One-command report export (`report`, `gsc_export_report`): Search Console's export files plus previous-period comparison, query-page pairs, sitemaps, `summary.md` and `report.json`
- Local dashboard: overview, queries, pages, opportunities, sitemaps and URL Inspection, settings; light and dark themes
- Google API features current to October 2026: hourly data (`hour`, `hourly_all`), Discover and Google News search types, response metadata for incomplete data
- Branded vs non-branded queries from per-project brand terms
- Chart notes (annotations) from the dashboard or Claude
- Opt-in anonymous usage metrics (GA4 Measurement Protocol) with a local log of everything sent
- Daily update check against npm
- Demo mode with sample data
- Weekly Google change watcher (`npm run check:google`, GitHub Action)
