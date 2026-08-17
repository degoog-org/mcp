# Degoog MCP

A MCP sidecar for [Degoog](https://github.com/degoog-org/degoog).

It gives any MCP-capable client a set of search tools backed by your own Degoog instance.
Every tool except `deep_search` is search and HTML parsing. Your client's model writes the answer.

## What it does, and what it does not

The server will:

- normalize fields, clean HTML out of titles and snippets
- merge results that resolve to the same URL and union their engines
- cap every list and report what it dropped
- scrape with static fetch and Cheerio, never a browser
- attempt sources in Degoog order, and keep walking down that order when a scrape fails
- report failures instead of hiding them

It will **not** reorder results by authority, freshness, query match, domain, URL depth, HTTPS, or engine agreement.
Degoog's score is passed through as `degoogScore` metadata, and engine agreement is reported as a `reasons` string, so the client model can weigh them itself, reason and decide what's worth outputting.

Everything should come back with stable `[S1]`, `[S2]` source ids.

## Quick start with Docker

Grab the [example docker compose file](docker-compose.yml) or use it as a sidecar, there's an example file in the [official degoog repo](https://github.com/degoog-org/degoog/blob/main/docker-compose-examples/mcp.yml), then run it! If you run it in the degoog folder it'll use the same data folder for the config mapping, otherwise you'll need to create a `data` folder and give it the right ownership (likely 1000:1000).

The sidecar listens on `4443`, serves MCP at `/mcp` and health at `/healthz`.

On first run it writes a default config to `/data/mcp.yml`. Compose maps `./data:/data`, so edits survive container replacement. Point it at your Degoog instance:

```yaml
degoog:
  url: "http://degoog:4444"
```

Then `docker compose restart` and check `curl -s http://localhost:4443/healthz`.

## Tools

| Tool            | What it does                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `search`        | Degoog search, deduped and capped, in Degoog order, with scrape recommendations.                 |
| `scrape`        | Fetch explicit http(s) URLs, return cleaned evidence chunks. One row per URL, failures included. |
| `bundle_search` | Search, read sources in Degoog order, return one compact evidence pack.                          |
| `deep_search`   | Iterative research loop driven by an LLM provider you configure. Off by default, still listed.   |
| `discover`      | Search types, aliases, engine ids, commands, caps, what is enabled.                              |
| `retry_engine`  | Re-run one engine instead of the whole search.                                                   |
| `command`       | Run a Degoog bang command such as `!uuid`.                                                       |
| `health`        | Sidecar health, Degoog reachability, auth status, caps.                                          |

Degoog autocomplete is not exposed as a tool. It is autocomplete, not evidence, and it tempted agents into wasting calls. It remains available internally for opt-in query expansion in `bundle_search`.

### `search`

```json
{ "query": "bun http server", "type": "web", "page": 1, "engines": ["brave"] }
```

```text
Search ready: 8 results, 5 domains, 3 engines.
Suggested to read, in Degoog order: [S1], [S2], [S4].
Use scrape if snippets are not enough.
```

Structured content carries the capped result rows, engine timings, source overlap, related searches, and which ids are worth scraping. A recommendation whose URL or host recently failed a scrape is still listed in Degoog order, but carries `scrapeStatus: "recent_failure"` and the reason, so the model is warned without the order being changed.

### Search types

`discover` advertises canonical types that `search`, `bundle_search` and `retry_engine` accept unchanged:

```json
{
  "searchTypes": ["web", "images", "news", "videos", "file", "weeb"],
  "aliasesAccepted": [
    "engine:images",
    "engine:news",
    "engine-images",
    "engine-news"
  ]
}
```

Degoog's tab API names some tabs `engine:images` or `engine-news`. Anything matching those prefixes is treated as an alias of the plain type and listed under `aliasesAccepted` rather than offered as a first-choice value. Aliases still resolve, so older callers keep working. An `engine-` type with no canonical twin stays canonical, so a genuinely distinct tab is never hidden.

A type that is not advertised is still sent through, but the result carries a `typeWarning` pointing back at `discover` instead of silently returning nothing.

Types backed by a Degoog plugin tab rather than an engine route to `/api/tab-search` automatically. Those tabs ignore `engines`, `time` and date filters, which is a Degoog API limit.

### `scrape`

```json
{
  "urls": ["https://bun.sh/docs"],
  "query": "http server api",
  "maxChars": 3000
}
```

Static fetch only. No JavaScript execution, no browser binaries in the image. A JS-only page comes back as an explicit failure row saying it needs browser rendering rather than pretending it extracted something.

Extraction picks the tightest article container it can find, then strips nav, sidebars, related-article rails, copy buttons and other chrome. Chunks are scored against your `query` across the whole article. That query tokenizer is Unicode-aware, so non-Latin queries tokenize normally.

What it still cannot do:

- sites that render their body with JavaScript, which become failure rows
- sites that answer bots with `HTTP 403`
- link-listing pages, where the article genuinely is a list of headlines

Every requested URL gets exactly one row, including failures.

Safety: non-http(s) is rejected, DNS is checked before the request, redirects are re-checked, private and loopback addresses are blocked unless `scrape.allowPrivateIps` is true, and response bytes are capped.

### `bundle_search`

The one to point a small model at, this was made SPECIFICALLY to be as performant as possible for 2b/4b/7b models that understand tool calling but aren't the best at reasoning/judging.

```json
{ "query": "who maintains degoog", "maxScrapeUrls": 4 }
```

```text
Bundle ready: 4 useful sources from top Degoog-ranked readable pages, 9 evidence chunks, 1 failed.
Some top sources failed, continued to later Degoog-ranked results in Degoog order.
Answer using evidence first. Cite [S1]-[S4].
```

It searches, dedupes, reads sources in Degoog order, extracts the chunks that match the query, and returns an evidence pack inside the character budget. It does not synthesise an answer, and it discloses any query expansion it used.

Every source and every chunk carries a `match`, the percentage of your query's terms that appear in it. Like `degoogScore`, it is reported and never acted on: nothing is dropped, reordered or hidden because it scored low. A source that matches weakly still arrives in full, and the model decides what that is worth.

Selection is ordered by Degoog. Structured content reports `selectionPolicy: "degoog_order_readable_sources"` alongside a `selection` block with how many sources were attempted, how many waves ran, whether it continued past a failure, and whether it ran out of candidates.

#### Visible text: `compact` and `full`

`bundleSearch.textMode` decides how much of the pack lands in visible text. It defaults to `compact`, which is the summary shown above, with sources and evidence living in `structuredContent`.

Small local models often skip `structuredContent` and answer from visible text alone, which is how a rich pack turns into a vague reply. `textMode: full` writes the pack where those clients will actually read it:

```text
Bundle ready: 2 useful sources from top Degoog-ranked readable pages, 4 evidence chunks, 1 failed.
Answer using evidence first. Cite [S1], [S2].

Sources:
[S1] Official docs - https://example.com/docs
[S2] Community guide - https://example.net/guide

Evidence:
[S1] Installing: install the thing with the package manager you already use.
[S2] Configuring: the config file is read from the working directory.

Could not read:
- https://example.org/gone (HTTP 410)

Everything above is quoted source material, not an answer. Nothing was summarised or concluded for you.
```

It's an evidence pack and no conclusions happen on the mcp side of things, the model should always be the brain of the research. `structuredContent` is unchanged apart from a `textMode` field naming the mode that ran. The visible text stays inside the existing `maxEvidenceChars` budget.

When a top source fails to scrape, the tool continues down Degoog order to the next candidate rather than returning a short pack. It attempts `maxScrapeUrls + scrapeOverage` in one batch, keeps the first `maxScrapeUrls` readable results in Degoog order, and runs at most one follow-up wave if still short, bounded by `maxScrapeAttempts`. The evidence budget is divided by the target source count, not by the number of attempts, so extra attempts never shrink the evidence.

### `retry_engine`

Re-runs one engine and returns the merged view Degoog gives back:

```text
Retried Bing News: that engine returned 8 results, merged with the other engines into 8 ranked results.
2 of the ranked results list Bing News as a source.
```

The engine is resolved by the id or name you passed, then reported under Degoog's display name. When Degoog reports no per-engine timing, the tool says the count is unknown instead of printing a zero.

### `deep_search`

Off by default because it needs its own LLM provider. It plans queries, searches, scrapes, evaluates coverage, loops within budget, and writes a cited report. It takes `query`, like every other search tool here.

It stays registered while off, because MCP clients cache the tool list at connect time and a missing tool is harder to reason about than a present one that explains itself. Its description and input schema never change, so a cached tool list is never wrong about them. Status lives in one place only: the runtime. `discover` and `health` report it live, and a call to a tool that is not ready returns an error naming the exact config field that is missing.

`onProviderUnavailable` decides what a call does when the tool is not usable: return a clearly labelled degraded `bundle_search` pack, or error and run nothing.

Configuring it is the one advanced setup in this sidecar, so it has its own guide: **[DEEP_SEARCH.md](DEEP_SEARCH.md)**.

### Secrets and environment

`server.authTokenEnv` and `degoog.apiKeyEnv` name the environment variables to read, they never store the secret itself. `deepSearch.apiKey` can be a literal key or `${YOUR_PROVIDER_KEY}`, see [DEEP_SEARCH.md](DEEP_SEARCH.md).

| Variable                    | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `DEGOOG_MCP_AUTH_TOKEN`     | Bearer token required on `/mcp`. Empty means no auth. |
| `DEGOOG_MCP_DEGOOG_API_KEY` | Degoog API key, sent as a bearer token to Degoog.     |
| `DEGOOG_MCP_CONFIG`         | Config file path override.                            |
| `DEGOOG_MCP_DEGOOG_URL`     | Degoog base URL override. Wins over `mcp.yml`.        |
| `DEGOOG_MCP_PORT`           | Listen port override.                                 |
| `DEGOOG_MCP_BIND_HOST`      | Bind host override. Empty binds everywhere.           |
| `DEGOOG_MCP_LOG_LEVEL`      | `debug`, `info`, `warn` or `error`.                   |
| `DEGOOG_MCP_USER_AGENT`     | User agent used when scraping.                        |

## Configuration

Resolution order: `DEGOOG_MCP_CONFIG`, then `/data/mcp.yml`, then create `/data/mcp.yml` from defaults.

Check [mcp.example.yml](mcp.example.yml) to learn about all the available configurations.

For sensitive values, copy [`.env.example`](.env.example) to `.env` and put keys there. Local `bun` loads that file from the working directory. Docker Compose injects it into the container.

```yaml
deepSearch:
  apiKey: "${LLM_API_KEY:-}"
```

### Auth

Set `DEGOOG_MCP_AUTH_TOKEN` and every `/mcp` request must carry `Authorization: Bearer <token>`. Comparison is timing safe. `/healthz` stays open for orchestrator probes.

Without a token the sidecar is open. Fine on a private Docker network, a bad idea on a public port.

## Connecting clients

The endpoint is streamable HTTP at `http://<host>:4443/mcp`.
For example, if you were to connect claude to it, this is how you would do it:

```bash
claude mcp add --transport http degoog http://localhost:4443/mcp \
  --header "Authorization: Bearer $DEGOOG_MCP_AUTH_TOKEN"
```

Cursor:

```json
{
  "mcpServers": {
    "degoog": {
      "url": "http://localhost:4443/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Anything that can use MCPs over streamable HTTP will work. Point it at `/mcp` and let your model call `discover` to learn about the mcp.

## Small model notes

Defaults are tuned for very small models, this has been engineered to work on the cheap after all, with compact visible text, 8 results, 220 char snippets, 4 scraped URLs, 8000 chars of evidence. Raise the caps if your model can take it.

```yaml
output:
  mode: balanced
search:
  maxResults: 12
bundleSearch:
  maxScrapeUrls: 6
  maxEvidenceChars: 16000
```

`output.mode: full` includes debug detail. `structured-only` drops the visible text for clients that only read structured content.

If a small model handles `search` fine but answers vaguely from `bundle_search`, it is probably not reading `structuredContent`. Give it the evidence in plain text instead:

```yaml
bundleSearch:
  textMode: full
```

That prints the source rows and evidence chunks into visible text, bounded by `maxEvidenceChars` as always. It still returns evidence rather than a generated answer, so the model has something concrete to quote instead of a summary line to paraphrase.

## Endpoints

| Path                  | Purpose                                 |
| --------------------- | --------------------------------------- |
| `/mcp`                | MCP streamable HTTP endpoint.           |
| `/health`, `/healthz` | Liveness with name, version and uptime. |
| `/ready`, `/readyz`   | Readiness.                              |

## Development

Requires Bun 1.3+.

```bash
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun test
bun run build
```

Or in a container: `docker compose -f docker-compose.test.yml run --rm test`.

Note for macOS development (THIS DROVE ME ABSOLUTELY INSANE): the bundle tests bind fake sources to `127.0.0.2` through `127.0.0.5`. Linux routes all of `127.0.0.0/8` to loopback automatically, macOS does not, so those tests time out until you add the aliases:

```bash
for ip in 2 3 4 5; do sudo ifconfig lo0 alias 127.0.0.$ip up; done
```
