# Contributing

Thanks for helping. Bug reports, Google API changes you've spotted, and pull requests are all welcome.

## Setup

```bash
npm install
npm run build
npm run demo        # dashboard with sample data, no Google account needed
```

`GSC_CONNECT_DEMO=1` makes the CLI and MCP server use sample data too, which is how most changes can be tested without credentials.

## Guidelines

- Keep runtime dependencies to a minimum. Google APIs are called with `fetch`, and charts are plain SVG.
- Anything that leaves the user's machine must be documented in the README's Privacy section. New usage-metric events must be added to the allowlist in `src/telemetry.ts`; anything not on the allowlist is dropped.
- In `web/assets`, render children with `fill()` from `common.js`, never `replaceChildren()`; optional children otherwise show up as the text "null".
- Before supporting a Search Console feature, check that it exists in the API (`npm run check:google`, or the [API reference](https://developers.google.com/webmaster-tools/v1/api_reference_index)). Don't fake UI-only features.
- Run `npm run build` before opening a pull request.

`LESSONS.md` lists rules learned from real bugs in this repo. Read it before changing code.
