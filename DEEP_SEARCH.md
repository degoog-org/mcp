# Configuring deep search

I tried my hardest to ACTAULLY create a deep search tool.
I noticed a lot of oss are pretending to do it or are achieving it by using sampling. Unfortunately sampling is deprecated and in less than a year will be fully removed from pretty much everywhere (read [here](https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging)).

The only way to truly achieve deep search nowadays is to utilise third party providers to create a querying loop and give back results. I built a list of providers in [./src/llm](./src/llm/) which you can use to connect the llm of your choice. Most would just work with openai-compat, but is still worth using the right ones if they are officially supported.

This obviously means that `deep_search` is the only tool in this sidecar that needs an LLM of its own. Every other tool is search and HTML parsing. In other tool calling your client's model writes the answer, and the sidecar costs nothing to run. With `deep_search` it orchestrates another model (or itself via api) to plan queries, judge coverage and write the report, so it needs a provider you supply.

Because of this, it ships turned **off**, with no provider and no model. That is deliberate as there is no sensible default as I have absolutely no clue what you intend of using for it. This is only true advanced setup step. Everything else works pretty much out of the box.

---

## Contents

- [Mminimum config](#minimum-config)
- [Supported providers](#supported-providers)
- [Full shape](#full-shape)
- [What happens when it cannot run](#what-happens-when-it-cannot-run)
- [Worked examples](#worked-examples)
- [Checking it works](#checking-it-works)

---

## Minimum config

Three fields in `/data/mcp.yml`:

```yaml
deepSearch:
  enabled: true
  provider: <provider_of_your_choice>
  model: <model_of_your_choice>
  baseUrl: <base_url_of_the_provider>
```

BaseUrl defaults to common localhost urls/ports, you may want to change it to map your internal docker network or proxies. Restart the server after updating config. Worth noting that without a `model` the tool reports a config error naming the field, instead of failing later against the provider. Some providers need one more field, see the table below.

---

## Supported providers

Nine providers, ported from the Degoog AI summary plugin so that both behave identically. The last column is what you must set beyond `provider` and `model`.

| `provider` | Default base URL | Also required |
| --- | --- | --- |
| `ollama` | `http://localhost:11434` | nothing |
| `llama-cpp` | `http://localhost:8080/v1` | nothing |
| `vllm` | `http://localhost:8000/v1` | nothing |
| `lm-studio` | `http://localhost:1234/v1` | nothing |
| `openai-compat` | none | `baseUrl` |
| `openai` | `https://api.openai.com/v1` | `apiKey` |
| `openrouter` | `https://openrouter.ai/api/v1` | `apiKey` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `apiKey` |
| `anthropic` | `https://api.anthropic.com/v1` | `apiKey` |

`baseUrl` is optional for anything with a default and overrides it when set. A bare origin keeps the provider's default path, so `http://gpu-box:11434` works without repeating `/v1`.

Use `openai-compat` for anything that speaks the OpenAI chat completions API but is not listed: a proxy, a gateway, a self-hosted runtime. It has no default base URL, so `baseUrl` is required.

---

## Full shape

```yaml
deepSearch:
  enabled: true
  provider: ""
  model: ""
  baseUrl: ""
  apiKey: ""
  maxTokens: 2000
  enableThinking: false
  onProviderUnavailable: bundle_search
  maxIterations: 2
  maxQueriesPerIteration: 4
  maxScrapeUrls: 8
  scrapeOverage: 4
  maxScrapeAttempts: 16
  maxEvidenceChars: 20000
  requireCitations: true
  timeout: 240000
  providerTimeout: 90000
  reportTimeout: 120000
```

| Field | Meaning |
| --- | --- |
| `enabled` | Master switch. False means the tool never calls a provider. |
| `provider` | One of the nine ids above. |
| `model` | Provider-native model id, for example `qwen3:8b` or `claude-opus-5`. Required. |
| `baseUrl` | Overrides the provider default. Required for `openai-compat`. |
| `apiKey` | Required for the hosted providers. See [Secrets](#secrets) below. |
| `maxTokens` | Cap on **each** provider call, not on the run. |
| `enableThinking` | Ask a reasoning-capable model to think. The thinking is discarded and never reaches the report. |
| `onProviderUnavailable` | `bundle_search` or `off`. See the next section. |
| `maxIterations` | How many plan, search, read, evaluate rounds to run. |
| `maxQueriesPerIteration` | How many queries the model may plan per round. |
| `maxScrapeUrls` | Readable sources to gather per run. Failed scrapes do not count against it. |
| `scrapeOverage` | Extra sources attempted per wave so scrape failures do not shrink the pack. |
| `maxScrapeAttempts` | Hard ceiling on scrape attempts for the whole run, failures included. |
| `maxEvidenceChars` | Total evidence budget handed to the report call. |
| `requireCitations` | Reject a report that cites nothing. |
| `timeout` | Whole `deep_search` deadline in milliseconds. |
| `providerTimeout` | Deadline for each planning or coverage-evaluation provider call, in milliseconds. |
| `reportTimeout` | Deadline for the final report provider call, in milliseconds. |

There are three provider calls per iteration: plan queries, evaluate coverage, write the report. `maxTokens` applies to each of them, so a run costs roughly `maxIterations * 3` calls of up to `maxTokens` output. Timeout values are milliseconds.

Source gathering works the same way as `bundle_search`: sources are attempted in Degoog order, `maxScrapeUrls + scrapeOverage` at a time, and when a page 403s or turns out to be JavaScript-only the loop keeps walking down Degoog order instead of returning a thinner pack. `maxScrapeAttempts` bounds the total. The `selection` block in the structured output reports what was attempted, how many waves ran, and whether it ran out of candidates or hit the ceiling.

Leave `enableThinking` off unless a specific model needs it to produce usable JSON. It costs tokens and latency for output that is thrown away.

---

## What happens when it cannot run

`deep_search` stays registered even when it is off. MCP clients cache the tool list at connect time, and a tool that vanishes is harder for a model to reason about than a present one that explains itself. Its description and input schema never change, so a cached tool list is never wrong about them, and the live status lives in exactly one place: the runtime.

`onProviderUnavailable` decides what a call actually does when the tool is not usable. That covers three cases:

1. `enabled` is false
2. `enabled` is true but a required field is missing
3. everything is configured but the provider is unreachable, or the model id is wrong

### `bundle_search` (default)

The call runs `bundle_search` on the same query and returns that evidence pack, loudly labelled:

```
DEGRADED RESULT, deep_search did not run. deep_search is disabled on this instance. ...
This is a bundle_search evidence pack. No queries were planned, no coverage was evaluated,
no report was written. Treat it as raw sources, not as research.
```

The structured content carries a `degraded` object naming what was requested, what actually ran, why, and how to fix it. Nothing is hidden: a caller can always tell a real report from a fallback pack, and never receives a fallback believing it was research.

### `off`

The call returns an error naming the missing field, and nothing runs in its place. The error does not suggest `bundle_search` either: setting `off` says you do not want that substitution, so the sidecar does not push you toward it.

Pick `off` when a degraded result is worse than no result, for example when a caller is going to act on the output automatically.

---

## Worked examples

Local Ollama, nothing else on the box:

```yaml
deepSearch:
  enabled: true
  provider: ollama
  model: qwen3:8b
```

Ollama on another machine:

```yaml
deepSearch:
  enabled: true
  provider: ollama
  model: qwen3:8b
  baseUrl: "http://192.168.1.50:11434"
```

llama.cpp server, default port:

```yaml
deepSearch:
  enabled: true
  provider: llama-cpp
  model: qwen3-8b-q4
```

Anything OpenAI-compatible that is not in the table, for example a local proxy:

```yaml
deepSearch:
  enabled: true
  provider: openai-compat
  model: my-model
  baseUrl: "http://127.0.0.1:9000/v1"
```

A hosted provider, erroring rather than degrading:

```yaml
deepSearch:
  enabled: true
  provider: anthropic
  model: claude-opus-5
  apiKey: "${LLM_API_KEY:-}"
  onProviderUnavailable: off
```

---

## Checking it works

`health` and `discover` both report the live state. `discover` returns:

```json
{
  "deepSearchEnabled": true,
  "deepSearchReady": false,
  "disabledTools": [
    {
      "name": "deep_search",
      "reason": "deepSearch is enabled but not configured in mcp.yml: deepSearch.model is empty, set the model id to run",
      "onCall": "it stays registered and every call returns a degraded bundle_search evidence pack, labelled as such",
      "useInstead": "bundle_search"
    }
  ]
}
```

`deepSearchEnabled` is the raw config flag. `deepSearchReady` is what actually matters: enabled **and** configured. An instance that is enabled but missing a model reports `ready: false` and is listed under `disabledTools`, so nothing ever reports a broken tool as available.

A successful run carries `provider` and `providerModel` in its structured output, so a report always says which model produced it.

---

## Timeouts

Every timeout in `mcp.yml` is milliseconds. `deepSearch.timeout` caps the whole run, `providerTimeout` caps each planning/evaluation call, and `reportTimeout` caps the final report call. If a local model is slow, raise those values or lower `maxIterations`, `maxScrapeUrls`, and `maxTokens`.

---

## Small models

If a small model handles `search` fine but answers vaguely from `bundle_search`, it is probably not reading `structuredContent`. Set this so sources and evidence chunks are printed as visible text:

```yaml
bundleSearch:
  textMode: full
```

That still returns evidence, not a generated answer, and the existing `maxEvidenceChars` budget still bounds the output.