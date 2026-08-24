# Bundle search

The one to point a small model at. Built for 2b to 7b models that understand tool calling but are not the best at reasoning or judging.

```json
{ "query": "who maintains degoog", "maxScrapeUrls": 4 }
```

```text
Bundle ready: 4 useful sources from top Degoog-ranked readable pages, 9 evidence chunks, 1 failed.
Some top sources failed, continued to later Degoog-ranked results in Degoog order.
Answer using evidence first. Cite [S1]-[S4].
```

One call searches, dedupes, reads sources in Degoog order, extracts the chunks that match your query, and returns an evidence pack inside a character budget. It does not synthesise an answer, and it discloses any query expansion it used.

The point is to remove the step where a small model gets a list of ten links and has to decide which three are worth opening. That decision is where they fall down. Here they get the reading already done.

## Selection

Degoog decides the order. Nothing gets reranked here.

`structuredContent` reports `selectionPolicy: "degoog_order_readable_sources"` alongside a `selection` block, covering how many sources it attempted, how many waves ran, whether it continued past a failure, and whether it ran out of candidates.

When a top source fails to scrape, the tool walks down Degoog order to the next candidate, so the pack does not come back short. It attempts `maxScrapeUrls + scrapeOverage` in one batch, keeps the first `maxScrapeUrls` readable results in Degoog order, and runs at most one follow up wave if it is still short, bounded by `maxScrapeAttempts`.

The evidence budget is divided by the target source count, not by how many attempts it took, so a run of failures never shrinks the evidence you get.

## Match scores

Every source and every chunk carries a `match`, the percentage of your query's terms that appear in it. Like `degoogScore`, it reports the number and acts on none of it. Nothing gets dropped, reordered or hidden for scoring low. A source that matches weakly still arrives in full, and the model decides what that is worth.

## Query expansion

Off by default. `bundleSearch.queryExpansion` can pull in Degoog autocomplete suggestions or related searches to widen the net. Whatever it used comes back in the response, so a model never ends up answering a question you did not ask.

## Visible text: `compact` and `full`

`bundleSearch.textMode` decides how much of the pack lands in visible text. Default is `compact`, the summary above, with sources and evidence in `structuredContent`.

Small local models often skip `structuredContent` entirely and answer from visible text alone. That is how a rich pack turns into a vague reply. `textMode: full` writes the pack where those clients will actually read it:

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

It is an evidence pack. No conclusions get drawn on this side, the model is the brain of the research.

`structuredContent` stays the same apart from a `textMode` field naming the mode that ran, and the visible text stays inside the existing `maxEvidenceChars` budget.

## If the answers are vague

If a small model handles `search` fine but answers vaguely from `bundle_search`, it is almost certainly not reading `structuredContent`. Give it the evidence in plain text instead:

```yaml
bundleSearch:
  textMode: full
scrape:
  textMode: full
```

You still get evidence and not a generated answer, so the model has something concrete to quote.

## Caps

| Setting | Default | What it does |
| --- | --- | --- |
| `bundleSearch.maxScrapeUrls` | 4 | Readable sources kept |
| `bundleSearch.scrapeOverage` | 3 | Extra candidates attempted per wave |
| `bundleSearch.maxScrapeAttempts` | 10 | Hard ceiling on fetches |
| `bundleSearch.maxEvidenceChars` | 8000 | Evidence budget for the pack |
| `bundleSearch.queryExpansion` | `off` | `off`, `suggestions` or `related` |
| `bundleSearch.textMode` | `compact` | How much lands in visible text |
| `bundleSearch.timeout` | 90000 | Whole call deadline in ms |

Full list in [SETTINGS.md](SETTINGS.md).
