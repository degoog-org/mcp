# Proxies and delegated fetching

Static fetch handles most pages and fails honestly on the rest. When you want something better at retrieval, there are two ways to change how a page is fetched, and they solve different problems.

| | Transparent proxy | Delegated fetcher |
| --- | --- | --- |
| Configured with | Environment variables | `scrape.fetcher` in `mcp.yml` |
| Affects | Every outgoing request, including calls to Degoog | Page fetches only |
| The service sees | A normal HTTP request it forwards | A URL you asked it to go and get |
| Good for | Egress control, MITM inspection, network wide interception | Renderers and fetch services that speak their own API |

You can run both at once.

## Transparent proxy

The sidecar runs on Bun, which respects the standard proxy environment variables. Nothing here needs configuring, it already works (Example configuration kindly provided by [@quackerd](https://github.com/quackerd)):

```yaml
environment:
  HTTP_PROXY: "http://trawl:8192"
  HTTPS_PROXY: "http://trawl:8192"
  NO_PROXY: "degoog.example.com,localhost,127.0.0.1"
  NODE_EXTRA_CA_CERTS: "/certs/ca.crt"
volumes:
  - ./certs/ca.crt:/certs/ca.crt:ro
```

`HTTP_PROXY` and `HTTPS_PROXY` route outgoing fetches through the proxy. `NO_PROXY` keeps Degoog itself and any local or internal endpoint out of that path, which you almost certainly want, since there is no reason to send your own instance's traffic through an external hop.

If the proxy intercepts HTTPS, mount its CA certificate and trust it with `NODE_EXTRA_CA_CERTS`. Without that, every HTTPS fetch fails certificate validation and you get a wall of failure rows.

An interception proxy can add JS rendering, anti anti-bot and challenge solving without a single line of config here. The sidecar never learns any of it happened.

## Delegated fetcher

Some services are not proxies. They are endpoints you POST a URL to, and they hand back the HTML they got. A proxy variable cannot reach those. The URL has to travel inside the request, so pointing traffic at a destination does nothing.

`scrape.fetcher` covers that case. It describes one HTTP call:

| Key | Default | What it is |
| --- | --- | --- |
| `url` | `""` | Your service's endpoint. Empty means built in static fetch. |
| `method` | `GET` | HTTP method for the call |
| `headers` | `{}` | Headers sent with it, auth included |
| `body` | `""` | Request body, sent as written |
| `html` | `""` | Dot path to the HTML in a JSON reply. Empty means the body is the HTML. |

It fills in two placeholders before making the call:

- `{{url}}` is the page you want fetched
- `{{timeout}}` is `scrape.timeout` in milliseconds

The simplest shape, a service that takes a URL on the query string and returns HTML:

```yaml
scrape:
  fetcher:
    url: "http://your-fetcher:8080/get?url={{url}}"
```

A service that wants a JSON envelope and buries the HTML in its reply:

```yaml
scrape:
  fetcher:
    url: "http://your-fetcher:8080/v1"
    method: POST
    headers:
      Content-Type: "application/json"
      Authorization: "Bearer ${YOUR_FETCHER_TOKEN}"
    body: '{"url":"{{url}}","maxTimeout":{{timeout}}}'
    html: "result.body"
```

Anything that answers one HTTP request with HTML works, whether the HTML is the whole body or sits in a JSON field. What produced it is your business.

### Where it stops

One HTTP round trip is the limit. Outside it:

- WebSocket driver protocols, where you drive a browser instead of asking for a page
- multi step session APIs, create a job, poll it, collect the result
- libraries and binaries, which are not listening on a port at all

Those need a small HTTP wrapper of your own. Your wrapper picks its own request shape, so once it exists you are back to the three line config above.

### What stays on this side

The sidecar still does all of this:

- the address guard checks the target URL before it goes anywhere, so nobody reaches an address through your fetcher that direct fetch would have refused
- it reads the reply under `scrape.maxResponseBytes`, so a talkative or broken service cannot blow memory
- extraction, chunking and every budget in [SCRAPE.md](SCRAPE.md) run exactly as before

Your fetcher's own endpoint gets no address check, because you put it in your config and it is supposed to resolve to a private address.

### The tradeoff

The static fetcher walks redirects itself and re checks the address guard at every hop. A delegated fetcher follows redirects internally, where you cannot see them, so per hop re checking is gone and `redirects` comes back empty. That is the price of letting something else do the fetching.

Failures still say what went wrong. A refusal from your service comes back as a failure row carrying its status. A reply with no HTML at the path you configured says exactly that. So does a page that arrives still unrendered, and the message names your fetcher, not static fetch.

### Checking it is on

`discover` and the `scrape` result both report `scrapeRenderer`. It reads `static` normally, and `delegated` once a fetcher URL is set. If you configured one and still see `static`, your config did not load.
