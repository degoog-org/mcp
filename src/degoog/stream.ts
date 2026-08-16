import type { DegoogClient } from "./client.ts";
import { logger } from "../utils/logger.ts";
import { searchParams } from "./search.ts";
import {
  DegoogRoute,
  type DegoogResult,
  type DegoogSearchResponse,
  type DegoogTiming,
  type SearchQueryInput,
  type StreamEvent,
} from "./types.ts";

const LOG_NS = "degoog-stream";

export const parseSse = (chunk: string): StreamEvent[] => {
  const events: StreamEvent[] = [];

  for (const block of chunk.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    let name = "message";
    const dataLines: string[] = [];

    for (const line of trimmed.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    if (!dataLines.length) continue;
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join("\n")) });
    } catch (err) {
      logger.debug(LOG_NS, `unparsable sse payload for event=${name}`, err);
    }
  }

  return events;
};

export const readEvents = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const boundary = buffer.lastIndexOf("\n\n");
      if (boundary === -1) continue;

      const ready = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);
      for (const event of parseSse(ready)) yield event;
    }
    for (const event of parseSse(buffer)) yield event;
  } finally {
    reader.releaseLock();
  }
};

interface EngineResultData {
  engine?: string;
  timing?: DegoogTiming;
  results?: DegoogResult[];
}

interface DoneData {
  totalTime?: number;
  engineTimings?: DegoogTiming[];
  relatedSearches?: string[];
  totalPages?: number;
}

export const streamSearch = async (
  client: DegoogClient,
  input: SearchQueryInput,
  signal?: AbortSignal,
): Promise<DegoogSearchResponse> => {
  const response = await client.raw({
    path: DegoogRoute.SearchStream,
    query: searchParams(input),
    accept: "text/event-stream",
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Degoog stream failed (HTTP ${response.status})`);
  }

  let results: DegoogResult[] = [];
  let timings: DegoogTiming[] = [];
  let done: DoneData = {};

  for await (const event of readEvents(response.body)) {
    if (event.event === "engine-result") {
      const data = event.data as EngineResultData;
      if (data.results?.length) results = data.results;
      if (data.timing) timings = [...timings, data.timing];
    } else if (event.event === "done") {
      done = event.data as DoneData;
    }
  }

  return {
    results,
    query: input.query,
    type: input.type ?? "web",
    totalTime: done.totalTime ?? 0,
    engineTimings: done.engineTimings ?? timings,
    relatedSearches: done.relatedSearches ?? [],
    totalPages: done.totalPages,
  };
};
