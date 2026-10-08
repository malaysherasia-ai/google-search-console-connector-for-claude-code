# Roadmap: Google Search Console Connector

## Overview

Start with secure Google sign-in and a browser Connect flow, expose Search
Console to Claude Code over MCP, add a SaaS-grade local dashboard, add
opt-in anonymous usage metrics, then package for GitHub, npm and
claude-repo.com.

## Phases

- [ ] **Phase 1: Auth core + Connect flow** - Browser onboarding from no credentials to a stored refresh token and linked property
- [ ] **Phase 2: MCP server** - Claude Code can query and act on GSC for the linked project
- [ ] **Phase 3: Dashboard** - SaaS-grade local dashboard of the latest GSC metrics
- [ ] **Phase 4: Opt-in usage metrics** - One-time consent, GA4 via Measurement Protocol, fully transparent
- [ ] **Phase 5: Packaging + docs** - Publishable on GitHub, npm and claude-repo.com

## Phase Details

### Phase 1: Auth core + Connect flow
**Goal**: A user goes from no credentials to a stored refresh token and a linked property, entirely in the browser.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, LINK-01
**Success Criteria** (what must be TRUE):
  1. Connect page guides Google Cloud setup with direct console links
  2. Sign-in round-trip stores tokens; reload shows the connected account
  3. Bad client ID, cancelled consent and a reused callback each show an actionable error
**Plans**: 1 plan (built in initial scaffold)

### Phase 2: MCP server
**Goal**: Claude Code can query and act on GSC for the linked project.
**Depends on**: Phase 1
**Requirements**: LINK-02, MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08
**Success Criteria** (what must be TRUE):
  1. `claude mcp add` registers the server and all tools list in /mcp
  2. Every tool returns a clear error when not connected
  3. Verification flow works: token, Claude edits site, verify succeeds
**Plans**: 1 plan (built in initial scaffold)

### Phase 3: Dashboard
**Goal**: A SaaS-grade local dashboard of the latest GSC metrics.
**Depends on**: Phase 1
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08
**Success Criteria** (what must be TRUE):
  1. Overview loads in under 3 s for a 16-month range
  2. Charts follow the one-axis rule, have tooltips and work in dark mode
  3. Usable at 375 px width
**Plans**: TBD

### Phase 4: Opt-in usage metrics
**Goal**: Anonymous usage metrics only from users who said yes, with nothing hidden.
**Depends on**: Phase 1
**Requirements**: PRIV-01, PRIV-02, PRIV-03, PRIV-04, PRIV-05
**Success Criteria** (what must be TRUE):
  1. First run asks once; until answered nothing is sent
  2. "No" results in zero network calls to analytics
  3. Settings shows every event sent and lets the user change their answer
**Plans**: TBD

### Phase 5: Packaging + docs
**Goal**: Publishable on GitHub, npm and claude-repo.com.
**Depends on**: Phases 1-4
**Requirements**: DIST-01, DIST-02
**Success Criteria** (what must be TRUE):
  1. `npx google-search-console-connector --help` works from a clean machine
  2. README covers Google Cloud setup, install line and privacy
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Auth core + Connect flow | 0/1 | In progress | - |
| 2. MCP server | 0/1 | In progress | - |
| 3. Dashboard | 0/TBD | In progress | - |
| 4. Opt-in usage metrics | 0/TBD | In progress | - |
| 5. Packaging + docs | 0/TBD | Not started | - |
