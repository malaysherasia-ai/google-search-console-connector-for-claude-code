# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

First release.

- One-click Google sign-in (built-in OAuth client; own Google Cloud project optional), site-verification permission requested only when needed
- claude-repo.com brand: dark theme by default, Inter and JetBrains Mono self-hosted (no Google Fonts requests), gsc-connector wordmark, new icon
- Privacy policy and Google verification guide in docs/

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
