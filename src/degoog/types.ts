export enum DegoogRoute {
  Search = "/api/search",
  SearchStream = "/api/search/stream",
  SearchRetry = "/api/search/retry",
  Suggest = "/api/suggest",
  SuggestOpenSearch = "/api/suggest/opensearch",
  SearchTabs = "/api/search-tabs",
  TabSearch = "/api/tab-search",
  Engines = "/api/engines",
  Extensions = "/api/extensions",
  Commands = "/api/commands",
  Command = "/api/command",
  Health = "/healthz",
  Ready = "/readyz",
}

export enum SearchTimeFilter {
  Any = "any",
  Hour = "hour",
  Day = "day",
  Week = "week",
  Month = "month",
  Year = "year",
  Custom = "custom",
}

export interface DegoogResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  source: string;
  score?: number;
  sources?: string[];
  thumbnail?: string;
  imageUrl?: string;
  duration?: string;
}

export interface DegoogTiming {
  name: string;
  time: number;
  resultCount: number;
  status?: string;
  errorReason?: string;
  httpStatus?: number;
}

export interface DegoogSearchResponse {
  results: DegoogResult[];
  query: string;
  type: string;
  totalTime: number;
  engineTimings: DegoogTiming[];
  relatedSearches: string[];
  totalPages?: number;
  timing?: DegoogTiming;
}

export interface DegoogSuggestion {
  text: string;
  source?: string;
}

export interface DegoogTab {
  id: string;
  name: string;
  icon: string | null;
}

export interface DegoogExtension {
  id: string;
  name?: string;
  enabled?: boolean;
  description?: string;
}

export interface DegoogCommand {
  trigger: string;
  aliases?: string[];
  description?: string;
  category?: string;
}

export interface SearchQueryInput {
  query: string;
  type?: string;
  page?: number;
  time?: string;
  lang?: string;
  dateFrom?: string;
  dateTo?: string;
  engines?: string[];
  safeMode?: string;
}

export interface RetryQueryInput extends SearchQueryInput {
  engine: string;
}

export interface StreamEvent {
  event: string;
  data: unknown;
}
