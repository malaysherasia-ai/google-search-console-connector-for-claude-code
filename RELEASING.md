# Releasing

Each release is planned from two inputs: **what Google changed** and **what people use**.

## 1. Collect the inputs

**Google changes.** A GitHub Action runs `scripts/check-google-updates.mjs` every Monday. It diffs Google's live API definitions (the Search Console and Site Verification discovery documents) against `google-api/snapshot.json`, and scans the Search Central blog for Search Console posts. When something changed, it opens an issue labelled `google-update`. Run it any time with:

```bash
npm run check:google
```

Then read the [Search Console API reference](https://developers.google.com/webmaster-tools/v1/api_reference_index) and the [Search Central blog](https://developers.google.com/search/blog) for detail. New UI-only features go in the README table "What Google's API does and doesn't expose" rather than being faked.

**Usage** comes from GA4, and only from people who opted in. Look at:

- `mcp_tool_called` by `tool`: which Claude tools people rely on, and the `ok=0` rate (failures)
- `view_changed` by `view`, plus `range_changed`, `search_type_changed`, `query_type_changed`, `chart_grouped`: what people look at in the dashboard
- `report_exported`, `export_csv`, `url_inspected`, `note_added`: which workflows get used
- `dashboard_error` by `area`: where things break
- `consent_answered`: opt-in count (only "yes" answers are recorded)

## 2. Plan the milestone

With GSD: `/gsd:new-milestone` with the Google changes and usage findings, then `/gsd:plan-phase`, `/gsd:execute-phase` and `/gsd:verify-work`. Keep `.planning/REQUIREMENTS.md` traceable to the issue numbers.

## 3. Ship

1. Update `src/version.ts`, `package.json` and both `version` fields in `server.json` (the MCP Registry entry). New API support is a minor release; fixes are patches.
2. Add a `CHANGELOG.md` entry.
3. Build with the build-time config, which is published to npm but never committed (`scripts/write-build-config.mjs`):
   - **OAuth client** for one-click sign-in: keep `.oauth-client.json` (gitignored, `{"clientId": "...", "clientSecret": "..."}`) in the repo root, or set `GSC_OAUTH_CLIENT_ID` and `GSC_OAUTH_CLIENT_SECRET`. It goes into `dist/builtin-client.json`. Without it the package asks users to bring their own client, so check the build prints `Wrote dist/builtin-client.json`.
   - **GA4 secret** so usage metrics can be sent: `GA_API_SECRET=<secret> npm run build` (PowerShell: `$env:GA_API_SECRET="<secret>"; npm run build`). It goes into `dist/ga-config.json`.

   `npm publish` rebuilds via `prepublishOnly`, so keep the variables set in that shell. Then test against a real property, and refresh the README screenshots if the UI changed (`npm run demo`).
4. Accept the new Google snapshot: `node scripts/check-google-updates.mjs --update`.
5. Tag `vX.Y.Z`, push, `npm publish`, and create a GitHub release from the changelog. Run `npm publish` in a normal terminal: npm asks for 2FA approval in the browser.
6. Once `npm view google-search-console-connector@X.Y.Z version` answers (new versions are staged for a few minutes), run `mcp-publisher publish` to update the MCP Registry. It rejects a version that isn't on npm yet.
7. Users see a "new version available" notice in the CLI and dashboard within a day.
