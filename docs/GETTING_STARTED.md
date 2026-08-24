# Getting started

Get the sidecar running, point it at your Degoog instance, and connect a client to it.

You need a working Degoog instance first. If you do not have one yet, start [there](https://github.com/degoog-org/degoog), come back when search works in a browser.

## 1. Run the thing

The sidecar keeps everything it owns in one `data` directory. Create it first and hand it to the user the container runs as:

```bash
mkdir -p ./data
sudo chown -R 1000:1000 ./data
```

Grab the [example compose file](../docker-compose.yml), or run it as a sidecar next to Degoog using [`mcp.yml`](https://github.com/degoog-org/degoog/blob/main/docker-compose-examples/mcp.yml) from the Degoog repo. If you run it from the Degoog folder it will share the same `data` directory and you can skip the step above.

```bash
docker compose up -d
```

It listens on `4443`, serves MCP at `/mcp` and health at `/healthz`.

## 2. Point it at Degoog

On first run it writes a default config to `/data/mcp.yml`. Compose maps `./data:/data`, so your edits survive the container being replaced.

```yaml
degoog:
  url: "http://degoog:4444"
```

Use the container name if both run on the same Docker network, the LAN address if they do not. Then restart and check it can see Degoog:

```bash
docker compose restart
curl -s http://localhost:4443/healthz
```

Everything else already has a working default. [SETTINGS.md](SETTINGS.md) covers the rest when you want it.

## 3. Lock it down

Set `DEGOOG_MCP_AUTH_TOKEN` and every `/mcp` request has to carry `Authorization: Bearer <token>`. Comparison is timing safe. `/healthz` stays open so orchestrators can still probe it.

```yaml
environment:
  DEGOOG_MCP_AUTH_TOKEN: "a-long-random-string"
```

Without a token the sidecar is wide open. That is fine on a private Docker network. It is a bad idea on a public port.

## 4. Connect a client

The endpoint is streamable HTTP at `http://<host>:4443/mcp`. Anything that speaks MCP over streamable HTTP will work.

Claude Code:

```bash
claude mcp add --transport http degoog http://localhost:4443/mcp \
  --header "Authorization: Bearer $DEGOOG_MCP_AUTH_TOKEN"
```

Cursor, and anything else using the same config shape:

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

Once connected, ask your model to call `discover`. It reports the search types, engine ids, commands, caps and what is turned on, so the model learns your instance and stops guessing at it.

## 5. Pick the right tool

| You want | Use |
| --- | --- |
| A list of results to look at | [`search`](SEARCH.md) |
| The contents of pages you already have URLs for | [`scrape`](SCRAPE.md) |
| One call that searches, reads and returns evidence | [`bundle_search`](BUNDLE_SEARCH.md) |
| A research loop that writes a cited report | [`deep_search`](../DEEP_SEARCH.md) |

If your model is small, start with `bundle_search`. It exists because 2b to 7b models call tools competently and then struggle to decide what to do with a list of links.

## Development

Requires Bun 1.3+.

```bash
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun test
bun run build
```

Note for macOS (this drove me absolutely insane): the bundle tests bind fake sources to `127.0.0.2` through `127.0.0.5`. Linux routes all of `127.0.0.0/8` to loopback on its own, macOS does not, so those tests time out until you add the aliases:

```bash
for ip in 2 3 4 5; do sudo ifconfig lo0 alias 127.0.0.$ip up; done
```
