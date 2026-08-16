import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { cleanTitle } from "../utils/text.ts";
import { canonicalUrl, isHttpUrl } from "../utils/urls.ts";
import { cleanText } from "./clean.ts";
import { NOISE_ATTR, PAGE_NOISE_SELECTORS, UI_CHROME_SELECTORS } from "./drop.ts";
import { toMarkdown } from "./markdown.ts";

type ContentRoot = cheerio.Cheerio<AnyNode>;

const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  "[itemprop='articleBody']",
  "#content",
  "#main-content",
  ".post-content",
  ".post-body",
  ".article-body",
  ".article-content",
  ".story-body",
  ".entry-content",
  ".markdown-body",
];

const MIN_ROOT_CHARS = 200;
const ROOT_KEEP_SHARE = 0.85;
const NOISE_MAX_SHARE = 0.5;

const APP_SHELL_HINTS = [
  "__NEXT_DATA__",
  "window.__NUXT__",
  "ng-app",
  "data-reactroot",
  "id=\"root\"",
  "id=\"app\"",
];

const META_DATE_KEYS = [
  "article:published_time",
  "article:modified_time",
  "og:updated_time",
  "date",
  "pubdate",
  "publish-date",
  "dc.date",
];

export interface Extraction {
  title: string;
  canonical: string;
  publishedAt: string | null;
  siteName: string | null;
  text: string;
  needsBrowser: boolean;
}

const metaValue = ($: cheerio.CheerioAPI, keys: string[]): string | null => {
  for (const key of keys) {
    const value =
      $(`meta[property='${key}']`).attr("content") ??
      $(`meta[name='${key}']`).attr("content");
    if (value?.trim()) return value.trim();
  }
  return null;
};

const pickTitle = ($: cheerio.CheerioAPI, fallback: string): string => {
  const candidates = [
    metaValue($, ["og:title", "twitter:title"]),
    $("h1").first().text(),
    $("title").first().text(),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanTitle(candidate);
    if (cleaned) return cleaned;
  }

  return cleanTitle(fallback, fallback);
};

const pickDate = ($: cheerio.CheerioAPI): string | null => {
  const meta = metaValue($, META_DATE_KEYS);
  if (meta) return meta;
  const timeAttr = $("time[datetime]").first().attr("datetime");
  return timeAttr?.trim() || null;
};

const pickCanonical = ($: cheerio.CheerioAPI, sourceUrl: string): string => {
  const href =
    $("link[rel='canonical']").attr("href") ?? metaValue($, ["og:url"]) ?? "";
  if (!href) return canonicalUrl(sourceUrl);
  try {
    return canonicalUrl(new URL(href, sourceUrl).toString());
  } catch {
    return canonicalUrl(sourceUrl);
  }
};

interface RootCandidate {
  node: ContentRoot;
  bodyChars: number;
  totalChars: number;
}

const stripNoise = ($: cheerio.CheerioAPI, root: ContentRoot): void => {
  root.find(UI_CHROME_SELECTORS).remove();
  root.find(PAGE_NOISE_SELECTORS).remove();

  const rootChars = Math.max(1, root.text().trim().length);

  root.find("[class], [id]").each((_, element) => {
    const node = $(element);
    const marker = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""}`;
    if (!NOISE_ATTR.test(marker)) return;
    if (node.text().trim().length > rootChars * NOISE_MAX_SHARE) return;
    node.remove();
  });
};

const rootCandidates = ($: cheerio.CheerioAPI): RootCandidate[] => {
  const found: RootCandidate[] = [];

  for (const selector of CONTENT_SELECTORS) {
    $(selector).each((_, element) => {
      const node = $(element) as unknown as ContentRoot;
      const totalChars = node.text().trim().length;
      if (totalChars < MIN_ROOT_CHARS) return;
      found.push({
        node,
        bodyChars: node.find("p, li, dd, blockquote").text().trim().length,
        totalChars,
      });
    });
  }

  return found;
};

const pickRoot = ($: cheerio.CheerioAPI): ContentRoot => {
  const body = $("body") as unknown as ContentRoot;
  const candidates = rootCandidates($);
  const best = Math.max(0, ...candidates.map((entry) => entry.bodyChars));
  if (best < MIN_ROOT_CHARS) return body;

  return candidates
    .filter((entry) => entry.bodyChars >= best * ROOT_KEEP_SHARE)
    .reduce((tightest, entry) =>
      entry.totalChars < tightest.totalChars ? entry : tightest,
    ).node;
};

const looksUnrendered = (html: string, text: string): boolean =>
  text.length < 200 && APP_SHELL_HINTS.some((hint) => html.includes(hint));

export const extract = (html: string, sourceUrl: string): Extraction => {
  const $ = cheerio.load(html);
  const fallbackTitle = isHttpUrl(sourceUrl)?.hostname ?? sourceUrl;

  const title = pickTitle($, fallbackTitle);
  const canonical = pickCanonical($, sourceUrl);
  const publishedAt = pickDate($);
  const siteName = metaValue($, ["og:site_name", "application-name"]);

  const root = pickRoot($);
  stripNoise($, root);
  const text = cleanText(toMarkdown($, root));

  return {
    title,
    canonical,
    publishedAt,
    siteName,
    text,
    needsBrowser: looksUnrendered(html, text),
  };
};
