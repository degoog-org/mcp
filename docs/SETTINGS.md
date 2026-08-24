# Settings

Every option lives in one YAML file. The annotated copy is [mcp.example.yml](../mcp.example.yml) in the repo root, built from the same defaults the sidecar ships with. That file is the reference. This page covers how it loads, and the things worth knowing before you start editing.

## Where the file comes from

Resolution order:

1. `DEGOOG_MCP_CONFIG`, if set
2. `/data/mcp.yml`
3. failing both, it writes `/data/mcp.yml` from defaults on first run

Compose maps `./data:/data`, so your edits survive the container being replaced. Restart after editing, since it reads the file at boot.

Anything missing from your file falls back to the default. So does anything unparseable, and the sidecar boots anyway, so a stray tab in one value cannot take the whole thing down. Every timeout and TTL in the file is milliseconds.

## Sections

| Section | Covers | Detail |
| --- | --- | --- |
| `server` | Bind host, port, auth token env, idle timeout | below |
| `degoog` | Your Degoog URL, API key env, timeout | [GETTING_STARTED.md](GETTING_STARTED.md) |
| `output` | Visible text mode and guidance lines | below |
| `search` | Result caps and snippet length | [SEARCH.md](SEARCH.md) |
| `scrape` | Fetching, extraction, budgets, the delegated fetcher | [SCRAPE.md](SCRAPE.md) |
| `bundleSearch` | Selection, waves, evidence budget | [BUNDLE_SEARCH.md](BUNDLE_SEARCH.md) |
| `deepSearch` | LLM provider and research loop | [DEEP_SEARCH.md](../DEEP_SEARCH.md) |
| `cache` | In memory cache size and TTL | below |

## Secrets

`mcp.yml` never holds a secret. `server.authTokenEnv` and `degoog.apiKeyEnv` name the environment variables to read from, nothing more.

Any string in the file also accepts `${VAR}` and `${VAR:-default}`, with `$$` for a literal `$`. Copy [`.env.example`](../.env.example) to `.env` and put keys there. Local `bun` reads that file from the working directory, Docker Compose injects it into the container.

```yaml
deepSearch:
  apiKey: "${LLM_API_KEY:-}"
```

## Environment variables

A few settings can come from the environment instead, and the environment wins over the file. Handy when one image covers several deployments.

| Variable | Purpose |
| --- | --- |
| `DEGOOG_MCP_AUTH_TOKEN` | Bearer token required on `/mcp`. Empty means no auth. |
| `DEGOOG_MCP_DEGOOG_API_KEY` | Degoog API key, sent as a bearer token to Degoog. |
| `DEGOOG_MCP_CONFIG` | Config file path override. |
| `DEGOOG_MCP_DEGOOG_URL` | Degoog base URL override. Wins over `mcp.yml`. |
| `DEGOOG_MCP_PORT` | Listen port override. |
| `DEGOOG_MCP_BIND_HOST` | Bind host override. Empty binds everywhere. |
| `DEGOOG_MCP_LOG_LEVEL` | `debug`, `info`, `warn` or `error`. |
| `DEGOOG_MCP_USER_AGENT` | User agent used when scraping. |

It respects the standard proxy variables too, see [PROXIES.md](PROXIES.md).

## `output.mode`

How much detail goes into the visible text of every tool.

| Mode | What it does |
| --- | --- |
| `compact` | Short summary, detail lives in `structuredContent`. Default. |
| `balanced` | More of the useful detail in visible text. |
| `full` | Includes debug detail. |
| `structured-only` | No visible text at all, for clients that only read structured content. |

Separately, `output.guidance` controls the lines that tell a model what to do next, "answer using evidence first", that sort of thing. Small models need them. Large ones read them as nagging. Set it to `false` to drop the lines, every piece of metadata stays where it was.

## Tuning for your model

The defaults are tuned for small models, because this was built to work on the cheap. Compact visible text, 8 results, 220 char snippets, 4 scraped URLs, 8000 chars of evidence.

Raise the caps if your model can take it:

```yaml
output:
  mode: balanced
search:
  maxResults: 12
bundleSearch:
  maxScrapeUrls: 6
  maxEvidenceChars: 16000
```

If a small model answers vaguely despite a rich evidence pack, it is not reading `structuredContent`. See [BUNDLE_SEARCH.md](BUNDLE_SEARCH.md).

## Auth

Set `DEGOOG_MCP_AUTH_TOKEN` and every `/mcp` request must carry `Authorization: Bearer <token>`. Comparison is timing safe. `/healthz` stays open for orchestrator probes.

Without a token the sidecar is open. Fine on a private Docker network, a bad idea on a public port.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/mcp` | MCP streamable HTTP endpoint. |
| `/health`, `/healthz` | Liveness with name, version and uptime. |
| `/ready`, `/readyz` | Readiness. |
