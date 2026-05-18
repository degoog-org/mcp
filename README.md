<p align="center">
  <img src="../src/public/images/degoog-logo.png" alt="Degoog Logo" width="100">
  <br />
  <h1 align="center">degoog-mcp</h1><br/>
</p>

Lightweight Go sidecar that exposes [Degoog](../README.md) to LLMs via the [Model Context Protocol](https://modelcontextprotocol.io). Speaks MCP over HTTP/SSE, runs in a tiny `scratch` container, gives any MCP-capable client two tools:

- **`search`** — fast meta-search, returns URLs + snippets.
- **`scrape`** — fetches URLs concurrently, returns clean Markdown (readability → html-to-markdown → cached).

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

Listens on `4443` by default. Healthcheck at `/healthz`. Config via `DEGOOG_MCP_*` env vars:

| Variable                   | Default                    | Notes                                                              |
| :------------------------- | :------------------------- | :----------------------------------------------------------------- |
| `DEGOOG_MCP_PORT`          | `4443`                     | HTTP/SSE listen port                                               |
| `DEGOOG_MCP_DEGOOG_URL`    | `http://degoog:4444`       | Where the Degoog aggregator lives. Default assumes shared compose. |
| `DEGOOG_MCP_API_KEY`       | _(empty)_                  | Optional. If set, sent as `Authorization: Bearer …` to Degoog.     |
| `DEGOOG_MCP_TIMEOUT`       | `15s`                      | Per-request timeout for both Degoog calls and scraped URLs.        |
| `DEGOOG_MCP_MAX_LENGTH`    | `12000`                    | Max scraped-markdown length before head+tail truncation.           |
| `DEGOOG_MCP_CACHE_EXPIRY`  | `30m`                      | Scrape cache TTL.                                                  |
| `DEGOOG_MCP_CACHE_SIZE_MB` | `64`                       | Scrape cache hard memory cap.                                      |
| `DEGOOG_MCP_LOG_LEVEL`     | `info`                     | `debug` / `info` / `warn` / `error`.                               |
| `DEGOOG_MCP_USER_AGENT`    | a believable Chrome UA     | Used by the scraper when fetching pages.                           |

If your Degoog instance has API-key protection enabled (Settings → Server), copy the 64-char hex key into `DEGOOG_MCP_API_KEY`.

<details>
<summary>Docker Compose — standalone</summary>

```yaml
services:
  degoog-mcp:
    image: ghcr.io/degoog-org/degoog-mcp:latest
    ports:
      - "4443:4443"
    environment:
      DEGOOG_MCP_DEGOOG_URL: "http://<your-degoog-host>:4444"
      DEGOOG_MCP_API_KEY: ""
    restart: unless-stopped
```

</details>

<details>
<summary>Docker Compose — alongside Degoog</summary>

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
    image: ghcr.io/degoog-org/degoog-mcp:latest
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

SSE endpoint: `http://localhost:4443/`

<details>
<summary>Claude Desktop</summary>

Claude Desktop talks stdio, so use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge. Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "degoog": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4443/"]
    }
  }
}
```

Restart Claude Desktop.

</details>

<details>
<summary>Claude Code (CLI)</summary>

```bash
claude mcp add --transport sse degoog http://localhost:4443/
```

</details>

<details>
<summary>Gemini CLI</summary>

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "degoog": {
      "url": "http://localhost:4443/"
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
      "url": "http://localhost:4443/",
      "transport": "sse"
    }
  }
}
```

For stdio-only clients, wrap with `npx mcp-remote http://localhost:4443/` the same way Claude Desktop does above.

</details>

## Tests

With Go installed:

```bash
go test -race ./tests/...
```

Without Go — run them in a throwaway container:

```bash
docker compose -f docker-compose.test.yml run --rm test
```

## Shoutout

Built on [modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk), [go-shiori/go-readability](https://github.com/go-shiori/go-readability), [JohannesKaufmann/html-to-markdown](https://github.com/JohannesKaufmann/html-to-markdown), [allegro/bigcache](https://github.com/allegro/bigcache). Full aggregator lives [one folder up](../README.md).

<p align="center">
  <br />
  <a href="https://www.buymeacoffee.com/fccview">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" width="150">
  </a>
</p>
