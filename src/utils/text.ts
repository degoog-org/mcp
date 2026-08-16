import * as cheerio from "cheerio";

const HAS_MARKUP = /[<&]/;

export const stripMarkup = (value: string): string =>
  HAS_MARKUP.test(value)
    ? cheerio.load(`<div>${value}</div>`)("div").text()
    : value;

export const squashSpace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const cleanTitle = (raw: string | null | undefined, fallback = ""): string => {
  const value = raw?.trim();
  if (!value) return fallback;
  return squashSpace(stripMarkup(value)) || fallback;
};
