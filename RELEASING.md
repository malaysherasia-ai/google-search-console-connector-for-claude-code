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

1. Update `src/version.ts` and `package.json`. New API support is a minor release; fixes are patches.
2. Add a `CHANGELOG.md` entry.
3. `npm run build`, test against a real property, and refresh the README screenshots if the UI changed (`npm run demo`).
4. Accept the new Google snapshot: `node scripts/check-google-updates.mjs --update`.
5. Tag `vX.Y.Z`, push, `npm publish`, and create a GitHub release from the changelog.
6. Users see a "new version available" notice in the CLI and dashboard within a day.
