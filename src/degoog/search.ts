import type { DegoogClient } from "./client.ts";
import {
  DegoogRoute,
  type DegoogSearchResponse,
  type SearchQueryInput,
} from "./types.ts";

export const searchParams = (
  input: SearchQueryInput,
): Record<string, string | number | undefined> => ({
  q: input.query,
  type: input.type,
  page: input.page,
  time: input.time,
  lang: input.lang,
  dateFrom: input.dateFrom,
  dateTo: input.dateTo,
  safeMode: input.safeMode,
});

export const searchBody = (input: SearchQueryInput): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    query: input.query,
    type: input.type,
    page: input.page,
    time: input.time,
    lang: input.lang,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    safeMode: input.safeMode,
  };
  if (input.engines?.length) body.engines = input.engines;
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }
  return body;
};

export const runSearch = async (
  client: DegoogClient,
  input: SearchQueryInput,
  signal?: AbortSignal,
): Promise<DegoogSearchResponse> => {
  if (input.engines?.length) {
    return client.json<DegoogSearchResponse>({
      path: DegoogRoute.Search,
      method: "POST",
      body: searchBody(input),
      signal,
    });
  }
  return client.json<DegoogSearchResponse>({
    path: DegoogRoute.Search,
    query: searchParams(input),
    signal,
  });
};

export const tabSearch = async (
  client: DegoogClient,
  tab: string,
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<DegoogSearchResponse> =>
  client.json<DegoogSearchResponse>({
    path: DegoogRoute.TabSearch,
    query: { tab, q: query, page },
    signal,
  });
