<p align="center">
  <img src="https://github.com/degoog-org/degoog/blob/main/src/public/images/degoog-logo.png" alt="Degoog Logo" width="100">
  <br />
  <h1 align="center">degoog</h1><br/>
</p>

Lightweight Go sidecar that exposes [Degoog](../README.md) to LLMs via the [Model Context Protocol](https://modelcontextprotocol.io). Speaks modern MCP Streamable HTTP at `/mcp`, keeps legacy SSE for older clients, runs in a tiny `scratch` container, and gives any MCP-capable client two tools:

- **`search`** - fast meta-search, returns a concise text summary plus structured URLs, snippets, engine timings, cap metadata, and source overlap.
- **`scrape`** - fetches URLs concurrently, returns clean Markdown plus one structured row per requested URL, including explicit error rows for failures.

**Still in beta.** Not intended for production use yet.

---

<p align="center">
  <a href="https://discord.gg/invite/mMuk2WzVZu">
    <img width="40" src="https://skills.syvixor.com/api/icons?i=discord">
  </a>
  <br />
  <i>Join our discord community</i>
  <br />
</p>

---

## Run

Listens on `4443` by default. Modern MCP endpoint at `/mcp`, legacy SSE at `/sse` and `/`, healthcheck at `/healthz`. Config via `DEGOOG_MCP_*` env vars:

| Variable                            | Default                    | Notes                                                              |
| :---------------------------------- | :------------------------- | :----------------------------------------------------------------- |
| `DEGOOG_MCP_BIND_HOST`              | _(empty)_                  | Optional bind host. Use `127.0.0.1` for local-only deployments.    |
| `DEGOOG_MCP_PORT`                   | `4443`                     | HTTP listen port.                                                  |
| `DEGOOG_MCP_DEGOOG_URL`             | `http://degoog:4444`       | Where the Degoog aggregator lives. Default assumes shared compose. |
| `DEGOOG_MCP_API_KEY`                | _(empty)_                  | Optional Bearer token sent to Degoog as an Authorization header.   |
| `DEGOOG_MCP_TIMEOUT`                | `15s`                      | Per-request timeout for both Degoog calls and scraped URLs.        |
| `DEGOOG_MCP_MAX_RESULTS`            | `0`                        | Cap on merged `search` results (top-scored kept). `0` = no cap. Trims context for small-window models. Overridable per call. |
| `DEGOOG_MCP_ENGINES`                | _(empty)_                  | Comma-separated engine ids to restrict every `search` to (e.g. `brave,duckduckgo`). Empty = instance defaults. Overridable per call. |
| `DEGOOG_MCP_MAX_LENGTH`             | `12000`                    | Max scraped-markdown length before head+tail truncation.           |
| `DEGOOG_MCP_MAX_URLS`               | `8`                        | Max URLs accepted by one `scrape` tool call.                       |
| `DEGOOG_MCP_SCRAPE_CONCURRENCY`     | `4`                        | Max concurrent URL fetches inside one `scrape` call.               |
| `DEGOOG_MCP_MAX_RESPONSE_BYTES`     | `2097152`                  | Max downloaded bytes per scraped response before readability.      |
| `DEGOOG_MCP_CACHE_EXPIRY`           | `30m`                      | Scrape cache TTL.                                                  |
| `DEGOOG_MCP_CACHE_SIZE_MB`          | `64`                       | Scrape cache hard memory cap.                                      |
| `DEGOOG_MCP_LOG_LEVEL`              | `info`                     | `debug` / `info` / `warn` / `error`.                               |
| `DEGOOG_MCP_USER_AGENT`             | a believable Chrome UA     | Used by the scraper when fetching pages.                           |

The scraper accepts only `http` and `https` URLs, resolves DNS before dialing, blocks private and local IP ranges, and repeats the checks on redirects.

| `DEGOOG_MCP_API_KEY`                | _(empty)_                  | Optional Bearer token sent to Degoog as an Authorization header.   |

Valid engine ids for `DEGOOG_MCP_ENGINES` (and the per-call `engines` argument) come from your instance: `GET /api/extensions?type=engine` lists them. Running a second Degoog instance with a single engine enabled is no longer necessary; restrict from the MCP side instead.

<details>
<summary>Docker Compose - standalone</summary>

```yaml
services:
  degoog-mcp:
    image: ghcr.io/degoog-org/mcp:latest
    ports:
      - "4443:4443"
    environment:
      DEGOOG_MCP_DEGOOG_URL: "http://<your-degoog-host>:4444"
| `DEGOOG_MCP_API_KEY`                | _(empty)_                  | Optional Bearer token sent to Degoog as an Authorization header.   |
      DEGOOG_MCP_BIND_HOST: ""
    restart: unless-stopped
```

</details>

<details>
<summary>Docker Compose - alongside Degoog</summary>

Both services on a shared network. The sidecar can reach the aggregator internally at `http://degoog:4444`.

```yaml
services:
  degoog:
    image: ghcr.io/degoog-org/degoog:latest
    volumes:
      - ./data:/app/data
    ports:
      - "4444:4444"
    networks: [degoog-net]
    restart: unless-stopped

  degoog-mcp:
    image: ghcr.io/degoog-org/mcp:latest
    depends_on: [degoog]
    ports:
      - "4443:4443"
    networks: [degoog-net]
    restart: unless-stopped

networks:
  degoog-net:
    driver: bridge
```

</details>

## Connect a client

Modern Streamable HTTP endpoint: `http://localhost:4443/mcp`

If your MCP host prefixes tool names with the server name, name the server `degoog` rather than an environment-specific label. That keeps exposed names short and obvious, e.g. `mcp_degoog_search` and `mcp_degoog_scrape`.

Legacy SSE endpoint: `http://localhost:4443/sse` (`/` is also kept for older users).

<details>
<summary>Claude Desktop / current Claude</summary>

Use HTTP transport where your Claude client supports remote MCP servers:

```json
{
  "mcpServers": {
    "degoog": {
      "type": "http",
      "url": "http://localhost:4443/mcp"
    }
  }
}
```

For stdio-only Claude Desktop builds, use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge. Edit `claude_desktop_config.json` (Settings -> Developer -> Edit Config):

```json
{
  "mcpServers": {
    "degoog": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4443/mcp"]
    }
  }
}
```

Restart Claude Desktop.

</details>

<details>
<summary>Claude Code (CLI)</summary>

```bash
claude mcp add --transport http degoog http://localhost:4443/mcp
```

</details>

<details>
<summary>Gemini CLI</summary>

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "degoog": {
      "url": "http://localhost:4443/mcp"
    }
  }
}
```

</details>

<details>
<summary>Cursor / Continue / Cline / other clients</summary>

Most editors that speak MCP accept a config block like:

```json
{
  "mcpServers": {
    "degoog": {
      "url": "http://localhost:4443/mcp",
      "transport": "http"
    }
  }
}
```

For stdio-only clients, wrap with `npx mcp-remote http://localhost:4443/mcp` the same way Claude Desktop does above.

Legacy SSE clients can use `http://localhost:4443/sse` with `transport: "sse"`. New clients should use `/mcp`.

</details>

## Tests

With Go installed:

```bash
go test -race -count=1 ./...
```

Without Go, run them in a throwaway container:

```bash
docker compose -f docker-compose.test.yml run --rm test
```

<p align="center">
  <br />
  <a href="https://www.buymeacoffee.com/fccview">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" width="150">
  </a>
</p>
