# Privacy Policy: Search Console Connector

Published at https://www.claude-repo.com/google-search-console-connector/privacy (this file is the source).

_Last updated: October 9, 2026_

Search Console Connector ("the app") is a free, open-source tool by Malay Sherasia that connects a website project to Google Search Console from Claude Code, Google Antigravity and other AI coding assistants, and shows the data in a dashboard on the user's own computer. Source code: https://github.com/malaysherasia-ai/google-search-console-connector-for-claude-code

## Summary

The app runs entirely on your computer. Your Google account data goes directly between your computer and Google. We (the developer) do not operate any server that receives, stores or processes your Google data, and we cannot see it.

## Google user data the app accesses

When you click "Sign in with Google", you are asked to grant:

| Permission | Why |
|---|---|
| View and manage Search Console data (`webmasters`) | To show your Search Console performance data (clicks, impressions, queries, pages, countries, devices), inspect URLs, list and submit sitemaps, and add properties, only when you or your AI assistant ask for it |
| Your email address (`openid`, `email`) | To show which Google account is connected |
| Verify site ownership (`siteverification`), asked only when needed | To get a verification token for a new site you own and ask Google to verify it, only when you ask the app to verify a site |

## How the data is used and stored

- **OAuth tokens** are stored only on your computer, in `~/.gsc-connect/`, readable only by your user account. Disconnecting (in the dashboard, or `npx google-search-console-connector logout`) revokes them at Google and deletes them.
- **Search Console data** is fetched from Google on demand and shown in the local dashboard, given to the AI assistant you are using on your computer, or saved as report files (CSV, JSON, Markdown) in your project folder when you ask for an export.
- **Project settings** (which property a project uses, brand terms, chart notes) are saved in your project folder in `.gsc-connect.json`.
- The developer never receives your tokens, your Search Console data, your sites, URLs, search queries or email address.

## Sharing

The app does not sell, share or transfer Google user data to anyone. Data you choose to give to your AI assistant (for example by asking it to analyze your Search Console data) is processed under that assistant's own terms.

Search Console Connector's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Anonymous usage metrics (optional)

On first use the app asks whether you want to share anonymous usage metrics. If you say no, nothing is sent. If you say yes, the app sends event names (for example "dashboard view opened" or "report exported"), the app version, your operating system and a random install ID to Google Analytics 4. These events never include Google user data: no sites, URLs, queries, metrics or email addresses. You can see every event sent, and change your answer, in the dashboard's Settings.

## Update check

Once a day the app asks the public npm registry for the latest version number. No personal data is included.

## Your choices

- Revoke access at any time in the app, or at https://myaccount.google.com/permissions
- Delete `~/.gsc-connect/` and your project's `.gsc-reports/` and `.gsc-connect.json` to remove everything the app stored.

## Contact

Questions about this policy: open an issue at https://github.com/malaysherasia-ai/google-search-console-connector-for-claude-code/issues, or reach Malay Sherasia through https://malay.sherasia.com

## Changes

Changes to this policy are published on this page and in the app's GitHub repository.
