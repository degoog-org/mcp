# Scrape

`scrape` fetches explicit http(s) URLs and returns cleaned evidence chunks. One row per URL, failures included.

```json
{ "urls": ["https://bun.sh/docs"], "query": "http server api", "maxChars": 3000 }
```

## How it reads a page

Static fetch and Cheerio. No JavaScript runs, and there are no browser binaries in the image.

It picks the tightest article container it can find, then strips nav, sidebars, related article rails, copy buttons and the rest of the chrome. It scores chunks against your `query` across the whole article, including everything below the fold. The tokenizer is Unicode aware, so non Latin queries tokenize normally.

Every requested URL gets exactly one row. A page it cannot read comes back as a failure row saying why. You will never get an empty success that looks like a page with nothing on it.

What static fetch cannot do:

- sites that render their body with JavaScript, which become failure rows
- sites that answer bots with `HTTP 403`
- link listing pages, where the article genuinely is a list of headlines

You can solve the first two by handing the fetch to something else, see [PROXIES.md](PROXIES.md).

## Images

It keeps image labels. An `alt`, `aria-label` or `title` carries real meaning on pages that use icons as data, like a support table where the tick is an image, or a build list where the platform is a logo. Drop them and that table comes back as a row of blanks.

Set `scrape.hideImages: true` if your pages are decorative and the labels are just noise.

## Safety

Before any request goes out, the sidecar:

- rejects anything that is not http(s)
- resolves DNS and checks the addresses
- re checks every redirect hop
- blocks private and loopback addresses unless `scrape.allowPrivateIps` is true
- caps response bytes at `scrape.maxResponseBytes`

The URLs reaching this tool came from search results, or from a page you scraped earlier. Someone else chose them. The address guard is what stops a crafted result from turning the sidecar into a probe of your own network. Turn `allowPrivateIps` on when you actually want to scrape your own intranet, and not before.

## Delegating the fetch

You can hand the fetch itself to any HTTP service you run. [PROXIES.md](PROXIES.md) covers it properly, but the short version is:

```yaml
scrape:
  fetcher:
    url: "http://your-renderer:8080/get?url={{url}}"
```

Extraction, chunking, budgets and the address guard all stay here. Only the retrieval moves.

## Visible text: `compact` and `full`

`scrape.textMode` defaults to `compact`, a summary with the evidence in `structuredContent`:

```text
Scraped 3 URLs: 2 useful, 1 failed.
Sources are labelled S1-S2.
Evidence chunks for each URL are in the structured content.
```

Clients that drop `structuredContent` see only that, so the model gets no page content at all. `textMode: full` writes the chunks where those clients read:

```text
Scraped 3 URLs: 2 useful, 1 failed.
Sources are labelled S1-S2.

Sources:
[S1] Bun docs - https://bun.sh/docs
[S2] Hono guide - https://hono.dev/guide

Evidence:
[S1] Install: run bun install to fetch deps.
[S2] Hono routes are declared with app.get.

Could not read:
- https://example.com/spa (needs browser rendering)

Everything above is quoted source material, not an answer. Nothing was summarised or concluded for you.
```

The rows in `structuredContent` are identical in both modes and the ids match.

`scrape.maxEvidenceChars` bounds the visible text, separately from the per URL `maxCharsPerUrl` budget. Four URLs at full depth is a lot of text for a small model. A closing line counts whatever got held back, and all of it is still in `structuredContent`.

## Caps

| Setting | Default | What it does |
| --- | --- | --- |
| `scrape.maxUrls` | 4 | URLs accepted per call |
| `scrape.concurrency` | 4 | Parallel fetches |
| `scrape.timeout` | 15000 | Per URL deadline in ms |
| `scrape.maxCharsPerUrl` | 3000 | Evidence kept per URL |
| `scrape.maxEvidenceChars` | 8000 | Visible text budget for the whole call |
| `scrape.allowPrivateIps` | false | Allow private and loopback targets |
| `scrape.hideImages` | false | Drop image labels from the text |
| `scrape.textMode` | `compact` | How much lands in visible text |

Full list in [SETTINGS.md](SETTINGS.md).
