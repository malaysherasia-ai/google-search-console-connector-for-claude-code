# GitHub repository metadata

Settings for https://github.com/malaysherasia-ai/google-search-console-connector-for-claude-code, chosen for search on GitHub and Google.

## About → Description (350 characters max)

```
Google Search Console MCP server and SEO dashboard for Claude Code, Antigravity and any MCP client. Sign in with Google, export GSC performance reports to CSV with one command, inspect URLs, submit sitemaps, verify sites and split branded vs non-branded queries. Free, open source, runs locally on your own Google Cloud project.
```

## About → Website

```
https://claude-repo.com/google-search-console-connector
```

## About → Topics (GitHub allows 20)

```
google-search-console search-console-api gsc mcp mcp-server model-context-protocol claude-code claude anthropic antigravity seo seo-tools seo-dashboard search-analytics url-inspection sitemap google-oauth csv-export typescript nodejs
```

## Social preview

Settings → General → Social preview → upload `docs/social-preview.png` (1280×640).

## Apply with the GitHub CLI

```bash
REPO=malaysherasia-ai/google-search-console-connector-for-claude-code
gh repo edit $REPO \
  --description "Google Search Console MCP server and SEO dashboard for Claude Code, Antigravity and any MCP client. Sign in with Google, export GSC performance reports to CSV with one command, inspect URLs, submit sitemaps, verify sites and split branded vs non-branded queries. Free, open source, runs locally on your own Google Cloud project." \
  --homepage "https://claude-repo.com/google-search-console-connector" \
  --enable-issues --enable-discussions \
  --add-topic google-search-console,search-console-api,gsc,mcp,mcp-server,model-context-protocol,claude-code,claude,anthropic,antigravity,seo,seo-tools,seo-dashboard,search-analytics,url-inspection,sitemap,google-oauth,csv-export,typescript,nodejs
```

The social preview image can only be uploaded in the web UI.

## Why these choices

- The repository name, the README H1 and the npm description all contain the phrases people search for: "Google Search Console", "Claude Code", "MCP server", "export ... CSV", "SEO dashboard".
- GitHub topics feed GitHub's topic pages and search filters; `mcp-server`, `claude-code` and `google-search-console` are the busiest relevant topics.
- The README FAQ answers the questions people type into Google ("Is the Search Console API free?", "export more than 1,000 rows"). Those answers are also easy for AI search engines to quote.
- Screenshots have descriptive alt text, and the social preview gives shared links a large, readable card.
- Also list the server where MCP users look: the official MCP Registry (registry.modelcontextprotocol.io), awesome-mcp-servers lists, and npm (the `keywords` in package.json are already set).
