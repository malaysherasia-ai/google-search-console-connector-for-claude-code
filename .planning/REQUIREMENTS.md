# Requirements

## v1

### Authentication (AUTH)
- [ ] **AUTH-01**: Default flow needs no Google Cloud setup: built-in client, "Sign in with Google" only; own client remains an advanced option
- [ ] **AUTH-06**: Site-verification permission is requested only when first needed (incremental auth)
- [ ] **AUTH-02**: User signs in with Google in the browser (loopback redirect, PKCE S256, state check)
- [ ] **AUTH-03**: Refresh token is stored locally with 0600 permissions; access tokens refresh automatically
- [ ] **AUTH-04**: User can disconnect, which revokes the token at Google
- [ ] **AUTH-05**: Revoked/expired grants produce a clear "connect again" message

### Project linking (LINK)
- [ ] **LINK-01**: User picks a GSC property for the current project; saved to `.gsc-connect.json`
- [ ] **LINK-02**: MCP tools default to the linked property when `siteUrl` is omitted

### MCP tools (MCP)
- [ ] **MCP-01**: gsc_connect opens the Connect page and waits for completion
- [ ] **MCP-02**: gsc_status, gsc_disconnect, gsc_list_sites, gsc_link_project
- [ ] **MCP-03**: gsc_search_analytics (dimensions, filters, date range, row limit)
- [ ] **MCP-04**: gsc_performance_summary (totals vs previous period, top queries/pages)
- [ ] **MCP-05**: gsc_inspect_url
- [ ] **MCP-06**: gsc_list_sitemaps, gsc_submit_sitemap, gsc_delete_sitemap
- [ ] **MCP-07**: gsc_add_site, gsc_get_verification_token, gsc_verify_site
- [ ] **MCP-08**: gsc_open_dashboard

### Dashboard (DASH)
- [ ] **DASH-01**: KPI tiles (clicks, impressions, CTR, position) with change vs previous period
- [ ] **DASH-02**: Trend chart for the selected metric with previous-period overlay and hover tooltip
- [ ] **DASH-03**: Queries and Pages tables: sortable, searchable, with change columns
- [ ] **DASH-04**: Countries and devices breakdown
- [ ] **DASH-05**: Opportunities: striking-distance queries (pos 4–20) and low-CTR pages
- [ ] **DASH-06**: Indexing: sitemaps status, submit sitemap, URL Inspection
- [ ] **DASH-07**: Property switcher, date ranges (7d, 28d, 3m, 6m, 12m, 16m), search type
- [ ] **DASH-08**: Light/dark theme, responsive, keyboard accessible

### Privacy & usage metrics (PRIV)
- [ ] **PRIV-01**: One-time consent screen before anything else; nothing is sent until answered
- [ ] **PRIV-02**: "No" means zero analytics network calls; DO_NOT_TRACK=1 / GSC_CONNECT_TELEMETRY=0 force off
- [ ] **PRIV-03**: GA4 via Measurement Protocol from the local process, allowlisted events and params only (no URLs, queries, emails, metric values)
- [ ] **PRIV-04**: Settings shows the exact events sent (local log) and lets the user change their answer
- [ ] **PRIV-05**: README "Privacy" section documents every event

### Reports (REPORT)
- [x] **REPORT-01**: One command (`report`, `gsc_export_report`) exports Search Console's export files as CSV plus previous-period comparison
- [x] **REPORT-02**: Query-page pairs, sitemaps, summary.md for agents, report.json; pages past 25k rows
- [x] **REPORT-03**: `--all-sites` for agencies with many properties; output git-ignored automatically

### Google currency (GOOG)
- [x] **GOOG-01**: Hourly data (hour dimension, hourly_all), Discover and Google News types, incomplete-data metadata
- [x] **GOOG-02**: Branded vs non-branded via project brand terms (RE2 regex filters)
- [x] **GOOG-03**: Weekly/monthly chart grouping; local chart annotations (Claude can add them)
- [x] **GOOG-04**: Weekly watcher diffs Google discovery docs + Search Central feed, opens issues
- [x] **GOOG-05**: In-app "new version available" notice

### Distribution (DIST)
- [ ] **DIST-01**: `npx google-search-console-connector` CLI: connect, dashboard, status, logout, mcp
- [ ] **DIST-02**: README with Google Cloud setup and `claude mcp add` install line

## Traceability

| Requirement | Phase |
|---|---|
| AUTH-* | 1 |
| LINK-*, MCP-* | 2 |
| DASH-* | 3 |
| PRIV-* | 4 |
| REPORT-*, GOOG-* | 3–4 (added mid-build) |
| DIST-* | 5 |
