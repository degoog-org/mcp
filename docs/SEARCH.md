# Search

`search` for results, `retry_engine` for one engine, `command` for bangs, and `discover` to find out what your instance can do.

## `search`

```json
{ "query": "bun http server", "type": "web", "page": 1, "engines": ["brave"] }
```

```text
Search ready: 8 results, 5 domains, 3 engines.
Suggested to read, in Degoog order: [S1], [S2], [S4].
Use scrape if snippets are not enough.
```

It normalizes the fields, merges results that resolve to the same URL and unions their engines, strips HTML out of titles and snippets, then hands the lot back in Degoog order. Every list has a cap, and every cap reports what it dropped.

`structuredContent` carries the result rows, engine timings, source overlap, related searches, and which ids are worth scraping.

## What it will not do

It will not reorder results by authority, freshness, query match, domain, URL depth, HTTPS, or engine agreement.

It passes Degoog's own score through as `degoogScore` and reports engine agreement as a `reasons` string. Both are metadata for the model to weigh.

## Scrape recommendations

A recommendation whose URL or host recently failed a scrape still shows up in Degoog order. It carries `scrapeStatus: "recent_failure"` and the reason, so the model sees the warning and the order stays untouched.

## Search types

`discover` advertises the canonical types that `search`, `bundle_search` and `retry_engine` accept unchanged:

```json
{
  "searchTypes": ["web", "images", "news", "videos", "file", "weeb"],
  "aliasesAccepted": ["engine:images", "engine:news", "engine-images", "engine-news"]
}
```

Degoog's tab API names some tabs `engine:images` or `engine-news`. Anything matching those prefixes becomes an alias of the plain type and lands under `aliasesAccepted`, so it never gets offered as a first choice. Aliases still resolve, and older callers keep working. An `engine-` type with no canonical twin stays canonical, so a genuinely distinct tab never gets hidden.

Send a type it does not advertise and it still goes through, but the result carries a `typeWarning` pointing you back at `discover`.

Types backed by a Degoog plugin tab rather than an engine route to `/api/tab-search` automatically. Those tabs ignore `engines`, `time` and date filters. That is a Degoog API limit, not a choice made here.

## `retry_engine`

Re-runs one engine and returns the merged view Degoog gives back:

```text
Retried Bing News: that engine returned 8 results, merged with the other engines into 8 ranked results.
2 of the ranked results list Bing News as a source.
```

It resolves the engine from the id or name you passed, then reports it under Degoog's display name. When Degoog sends back no per-engine timing, the count comes back as unknown. A confident zero would be a lie.

## `command`

Runs a Degoog bang command such as `!uuid` and returns what Degoog returns.

## `discover`

Search types, aliases, engine ids, commands, caps, and what is enabled. Point a model at this once per session and it stops guessing at your setup.

## No autocomplete tool

There is not one, on purpose. Agents kept spending calls on suggestions that were never going to be evidence. It is still there internally, for opt in query expansion in [`bundle_search`](BUNDLE_SEARCH.md).

## Visible text

`search.textMode` behaves like the one documented in [SCRAPE.md](SCRAPE.md). `compact` keeps the summary short and leaves the detail in `structuredContent`.

## Caps

| Setting | Default | What it does |
| --- | --- | --- |
| `search.maxResults` | 8 | Results kept per search |
| `search.snippetChars` | 220 | Snippet length before truncation |
| `search.textMode` | `compact` | How much lands in visible text |

Full list in [SETTINGS.md](SETTINGS.md).
