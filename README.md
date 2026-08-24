# Degoog MCP

A MCP sidecar for [Degoog](https://github.com/degoog-org/degoog).

It gives any MCP-capable client a set of search tools backed by your own Degoog instance.
Every tool except `deep_search` is search and HTML parsing. Your client's model writes the answer.

## What it does, and what it does not

The server will:

- normalize fields, clean HTML out of titles and snippets
- merge results that resolve to the same URL and union their engines
- cap every list and report what it dropped
- scrape with static fetch and Cheerio, or hand the fetch to any HTTP service you run
- attempt sources in Degoog order, and keep walking down that order when a scrape fails
- hand back failures as rows with a reason on them

It will **not** reorder results by authority, freshness, query match, domain, URL depth, HTTPS, or engine agreement.
Degoog's own score comes through as `degoogScore` and engine agreement as a `reasons` string. Both are there for the client model to weigh and act on.

Everything should come back with stable `[S1]`, `[S2]` source ids.

## Quick start

Grab the [example docker compose file](docker-compose.yml) or use it as a sidecar, there's an example file in the [official degoog repo](https://github.com/degoog-org/degoog/blob/main/docker-compose-examples/mcp.yml), then run it!

```bash
docker compose up -d
curl -s http://localhost:4443/healthz
```

The sidecar listens on `4443`, serves MCP at `/mcp` and health at `/healthz`. On first run it writes a default config to `/data/mcp.yml`. Point it at your instance:

```yaml
degoog:
  url: "http://degoog:4444"
```

Step by step, including the parts this skips: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

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

Degoog autocomplete is not exposed as a tool. Agents kept burning calls on suggestions that were never going to be evidence. It is still there internally, for opt-in query expansion in `bundle_search`.

If your model is small, point it at `bundle_search` first.

## Documentation

| Page | What's in it |
| --- | --- |
| [Getting started](docs/GETTING_STARTED.md) | Run it, point it at Degoog, lock it down, connect a client, develop on it. |
| [Search](docs/SEARCH.md) | `search`, `retry_engine`, `command`, `discover`, search types and aliases. |
| [Scrape](docs/SCRAPE.md) | Extraction, images, safety, evidence budgets, visible text modes. |
| [Bundle search](docs/BUNDLE_SEARCH.md) | Selection, waves, match scores, why small models do better with it. |
| [Proxies](docs/PROXIES.md) | Transparent HTTP proxies, and delegating the fetch to your own service. |
| [Settings](docs/SETTINGS.md) | How config loads, secrets, environment variables, tuning. |
| [Deep search](docs/DEEP_SEARCH.md) | The one advanced setup. Providers, models, the research loop. |

[mcp.example.yml](mcp.example.yml) annotates every option.

## Connecting clients

The endpoint is streamable HTTP at `http://<host>:4443/mcp`.

```bash
claude mcp add --transport http degoog http://localhost:4443/mcp \
  --header "Authorization: Bearer $DEGOOG_MCP_AUTH_TOKEN"
```

Anything that can use MCPs over streamable HTTP will work. Point it at `/mcp` and let your model call `discover` to learn what your instance can do. More clients in [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## Development

Requires Bun 1.3+.

```bash
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun test
```

Notes on macOS and the rest are in [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).
