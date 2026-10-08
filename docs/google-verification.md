# Built-in Google sign-in: setup and verification

The connector ships one Google OAuth client so users only click "Sign in with Google". This is the one-time setup for the maintainer. Use the personal Google account you want to own the app.

## Part A: create the client (about 10 minutes)

1. **Create a project:** https://console.cloud.google.com/projectcreate. Name it `Search Console Connector`.
2. **Enable two APIs** in that project:
   - https://console.cloud.google.com/apis/library/searchconsole.googleapis.com
   - https://console.cloud.google.com/apis/library/siteverification.googleapis.com
3. **Branding:** https://console.cloud.google.com/auth/branding
   - App name: `Search Console Connector`
   - User support email: your email
   - App logo: `docs/logo-120.png`. Uploading a logo triggers brand review; you can skip it for now and add it before submitting for verification.
   - Application home page: `https://claude-repo.com/google-search-console-connector`
   - Privacy policy: `https://claude-repo.com/google-search-console-connector/privacy` (publish `docs/privacy-policy.md` there first)
   - Authorized domain: `claude-repo.com`
   - Developer contact email: your email
4. **Audience:** https://console.cloud.google.com/auth/audience. User type **External**, then **Publish app** so it's "In production" (otherwise sign-ins expire every 7 days).
5. **Data access:** https://console.cloud.google.com/auth/scopes, then **Add or remove scopes** and add:
   - `openid`
   - `.../auth/userinfo.email`
   - `https://www.googleapis.com/auth/webmasters`
   - `https://www.googleapis.com/auth/siteverification`
6. **Client:** https://console.cloud.google.com/auth/clients/create. Application type **Desktop app**, name `Search Console Connector desktop`. Copy the **Client ID** and **Client secret** into `src/builtin-client.ts`.

From here the app works for up to 100 users, who see the "Google hasn't verified this app" notice.

## Part B: Google verification (removes the warning and the 100-user cap)

Before submitting:

- Publish the home page and the privacy policy at the URLs above. The home page must describe the app and link to the privacy policy.
- Verify `claude-repo.com` in Search Console with the same Google account (domain property, DNS record): https://search.google.com/search-console
- Add the logo (step 3) if you skipped it.

Then on https://console.cloud.google.com/auth/verification, click **Submit for verification**. Use these answers.

**Scope justifications**

- `webmasters`: "Search Console Connector is a free, open-source desktop tool that lets website owners work with their own Google Search Console data from their AI coding assistant (Claude Code, Antigravity) and a dashboard on their own computer. It reads performance data (clicks, impressions, queries, pages), inspects URLs, lists sitemaps, and at the user's request submits sitemaps and adds the user's own sites as properties. Submitting sitemaps and adding properties need write access, so the read-only scope is not sufficient. Data goes only between the user's computer and Google; the developer runs no server."
- `siteverification`: "Requested incrementally, only when the user asks the tool to verify ownership of a new website they built. The tool gets the verification meta tag or DNS token for that site and asks Google to verify it after the user deploys the tag."
- `userinfo.email`: "Shown in the app so the user can see which Google account is connected."

**Demo video** (unlisted YouTube link, 2–3 minutes). Show, in this order:

1. The terminal: install with `claude mcp add ...` and ask Claude Code "Connect this project to Google Search Console".
2. The browser Connect page opening on `127.0.0.1`, the usage-metrics question, then **Sign in with Google**.
3. Google's consent screen, with the app name and the requested permissions visible (zoom in so the URL bar shows the `client_id`).
4. Choosing a property; then Claude Code answering "How did the site do in the last 28 days?" and the dashboard showing the data.
5. Submitting a sitemap (shows why write access is needed).
6. Asking Claude to verify a new site: the "Allow site verification" page, Google's consent for `siteverification`, the meta tag being added, and verification succeeding.
7. Settings → Disconnect, which revokes access.

Google usually replies within a few days to a few weeks and may ask follow-up questions by email. When it's approved, set `BUILTIN_VERIFIED = true` in `src/builtin-client.ts` so the app stops warning users about the notice.
