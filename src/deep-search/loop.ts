import { pickCandidates, type Candidate } from "../bundle/candidate-picker.ts";
import { buildPack, type EvidencePack } from "../bundle/evidence-pack.ts";
import { gatherInDegoogOrder } from "../bundle/gather.ts";
import { searchCached } from "../degoog/cached.ts";
import type { DegoogSearchResponse } from "../degoog/types.ts";
import { runPipeline } from "../search/pipeline.ts";
import type { ShapedResult } from "../search/shape.ts";
import { scrapeUrls, type ScrapeRow } from "../scrape/pipeline.ts";
import { logger } from "../utils/logger.ts";
import type { ToolContext } from "../tools/context.ts";
import { checkCoverage, type Coverage } from "./evaluate.ts";
import { makePlan } from "./plan.ts";
import type { ResearchModel } from "./model.ts";

const LOG_NS = "deep-loop";

const usefulRows = (rows: ScrapeRow[]): number =>
  rows.filter((row) => row.ok).length;

export interface LoopInput {
  ctx: ToolContext;
  model: ResearchModel;
  question: string;
  type?: string;
  lang?: string;
  signal?: AbortSignal;
}

export interface IterationTrace {
  iteration: number;
  focus: string;
  queries: string[];
  scraped: string[];
  failures: number;
  waves: number;
  continuedAfterFailure: boolean;
  coverage?: Coverage;
}

export interface LoopSelection {
  target: number;
  attempted: number;
  useful: number;
  waves: number;
  continuedAfterFailure: boolean;
  surplusDiscarded: number;
  candidatesExhausted: boolean;
  attemptCapReached: boolean;
}

export interface LoopOutput {
  pack: EvidencePack;
  ranked: ShapedResult[];
  trace: IterationTrace[];
  searched: string[];
  selection: LoopSelection;
  stoppedBecause: string;
}

export const runLoop = async (input: LoopInput): Promise<LoopOutput> => {
  const { ctx, model, question } = input;
  const settings = ctx.config.deepSearch;

  const responses: Array<{ query: string; response: DegoogSearchResponse }> = [];
  const rows: ScrapeRow[] = [];
  const candidates: Candidate[] = [];
  const trace: IterationTrace[] = [];
  const searched: string[] = [];
  const seenUrls = new Set<string>();

  let ranked: ShapedResult[] = [];
  let pack: EvidencePack = {
    sources: [],
    chunks: [],
    failures: [],
    charsUsed: 0,
    chunksOmitted: 0,
  };
  let followUps: string[] = [];
  let stoppedBecause = "iteration budget spent";
  let attempted = 0;
  let waves = 0;
  let surplus = 0;
  let continued = false;
  let exhausted = false;

  for (let iteration = 0; iteration < settings.maxIterations; iteration++) {
    const plan = followUps.length
      ? { queries: followUps.slice(0, settings.maxQueriesPerIteration), focus: "" }
      : await makePlan(model, question, searched, settings.maxQueriesPerIteration);

    const fresh = plan.queries.filter((query) => !searched.includes(query));
    if (!fresh.length) {
      stoppedBecause = "no new queries proposed";
      break;
    }

    for (const query of fresh) {
      searched.push(query);
      const outcome = await searchCached(
        ctx.client,
        ctx.cache,
        { query, type: input.type, lang: input.lang },
        input.signal,
      );
      responses.push({ query, response: outcome.response });
    }

    ranked = runPipeline({
      responses,
      rankQuery: question,
      maxResults: settings.maxScrapeUrls * 2,
      snippetChars: ctx.config.search.snippetChars,
    }).results;

    const target = settings.maxScrapeUrls - usefulRows(rows);
    const attemptsLeft = settings.maxScrapeAttempts - attempted;
    const poolSize = Math.min(target + settings.scrapeOverage, attemptsLeft);

    const pool = pickCandidates(
      ranked.filter((result) => !seenUrls.has(result.url)),
      Math.max(0, poolSize),
    );

    for (const candidate of pool) seenUrls.add(candidate.url);
    candidates.push(...pool);

    const gathered = pool.length
      ? await gatherInDegoogOrder({
          candidates: pool,
          target,
          firstWave: Math.min(pool.length, target + settings.scrapeOverage),
          scrape: (urls) =>
            scrapeUrls(urls, {
              query: question,
              config: ctx.config.scrape,
              signal: input.signal,
            }),
        })
      : null;

    const newRows = gathered?.rows ?? [];
    rows.push(...newRows);

    attempted += gathered?.attempted ?? 0;
    waves += gathered?.waves ?? 0;
    surplus += gathered?.surplus ?? 0;
    if (gathered?.continued) continued = true;
    if (gathered?.exhausted) exhausted = true;

    pack = buildPack({
      rows,
      candidates,
      ranked,
      maxChars: settings.maxEvidenceChars,
    });

    const coverage = await checkCoverage(
      model,
      question,
      pack,
      settings.maxQueriesPerIteration,
      settings.maxEvidenceChars,
    );

    trace.push({
      iteration: iteration + 1,
      focus: plan.focus,
      queries: fresh,
      scraped: pool
        .slice(0, gathered?.attempted ?? 0)
        .map((candidate) => candidate.url),
      failures: newRows.filter((row) => !row.ok).length,
      waves: gathered?.waves ?? 0,
      continuedAfterFailure: gathered?.continued ?? false,
      coverage,
    });

    logger.debug(
      LOG_NS,
      `iteration=${iteration + 1} queries=${fresh.length} sources=${pack.sources.length} sufficient=${coverage.sufficient}`,
    );

    if (coverage.sufficient && !coverage.gaps.length) {
      stoppedBecause = "evidence judged sufficient with no gaps left open";
      break;
    }
    if (usefulRows(rows) >= settings.maxScrapeUrls) {
      stoppedBecause = `source budget spent, ${settings.maxScrapeUrls} readable sources gathered, raise deepSearch.maxScrapeUrls for more`;
      break;
    }
    if (attempted >= settings.maxScrapeAttempts) {
      stoppedBecause = `scrape attempt ceiling of ${settings.maxScrapeAttempts} reached with only ${usefulRows(rows)} readable sources, raise deepSearch.maxScrapeAttempts`;
      break;
    }

    stoppedBecause = coverage.gaps.length
      ? `iteration budget spent with gaps still open: ${coverage.gaps.join("; ")}`
      : "iteration budget spent";

    followUps = coverage.followUps.filter((query) => !searched.includes(query));
  }

  return {
    pack,
    ranked,
    trace,
    searched,
    selection: {
      target: settings.maxScrapeUrls,
      attempted,
      useful: usefulRows(rows),
      waves,
      continuedAfterFailure: continued,
      surplusDiscarded: surplus,
      candidatesExhausted: exhausted,
      attemptCapReached: attempted >= settings.maxScrapeAttempts,
    },
    stoppedBecause,
  };
};
