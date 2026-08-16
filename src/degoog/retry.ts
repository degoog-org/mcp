import type { DegoogClient } from "./client.ts";
import { searchBody, searchParams } from "./search.ts";
import {
  DegoogRoute,
  type DegoogSearchResponse,
  type RetryQueryInput,
} from "./types.ts";

export const retryEngine = async (
  client: DegoogClient,
  input: RetryQueryInput,
  signal?: AbortSignal,
): Promise<DegoogSearchResponse> => {
  if (input.engines?.length) {
    return client.json<DegoogSearchResponse>({
      path: DegoogRoute.SearchRetry,
      method: "POST",
      body: { ...searchBody(input), engine: input.engine },
      signal,
    });
  }
  return client.json<DegoogSearchResponse>({
    path: DegoogRoute.SearchRetry,
    query: { ...searchParams(input), engine: input.engine },
    signal,
  });
};
