# Security policy

This tool handles Google OAuth tokens for Search Console, so security reports are taken seriously.

**Report a vulnerability** privately through GitHub's [private vulnerability reporting](https://github.com/malaysherasia-ai/google-search-console-connector-for-claude-code/security/advisories/new). Please don't open a public issue.

## How the tool protects your account

- Tokens are stored only in `~/.gsc-connect/` with owner-only permissions and are never sent anywhere except Google.
- The local web server binds to `127.0.0.1`, validates the `Host` header (DNS-rebinding protection), and requires an HttpOnly session cookie set through a one-time launch link. State-changing routes accept only JSON POSTs.
- OAuth uses the loopback redirect with PKCE (S256) and a `state` check.
- A Content Security Policy blocks inline and third-party scripts on the dashboard.
- Disconnecting revokes the refresh token at Google.

## Supported versions

Only the latest release gets security fixes. The app tells you when a newer version is available.
