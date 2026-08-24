import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

const BLOCK_TAGS = new Set([
  "html",
  "body",
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
  "dl",
  "li",
  "tr",
  "blockquote",
  "pre",
  "figcaption",
  "dd",
  "dt",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const LABEL_ATTRS = ["alt", "aria-label", "title"];

const MAX_LABEL_CHARS = 80;

export interface MarkdownOptions {
  hideImages: boolean;
}

export const MARKDOWN_DEFAULTS: MarkdownOptions = { hideImages: false };

const squash = (value: string): string => value.replace(/[ \t]+/g, " ").trim();

const asElement = (node: AnyNode): Element | null =>
  node.type === "tag" ? (node as Element) : null;

const labelOf = ($: CheerioAPI, element: Element): string => {
  const selected = $(element);
  if (selected.attr("alt") === "") return "";

  for (const attr of LABEL_ATTRS) {
    const label = squash(selected.attr(attr) ?? "");
    if (label) return label.slice(0, MAX_LABEL_CHARS);
  }

  return "";
};

const textOf = (
  $: CheerioAPI,
  selected: Cheerio<AnyNode>,
  options: MarkdownOptions,
): string =>
  selected
    .contents()
    .toArray()
    .map((node) => {
      if (node.type === "text") return $(node).text();

      const element = asElement(node);
      if (!element) return "";

      if (element.tagName.toLowerCase() !== "img") {
        return textOf($, $(element), options);
      }

      if (options.hideImages) return "";
      const label = labelOf($, element);
      return label ? ` ${label} ` : "";
    })
    .join("");

const renderNode = (
  $: CheerioAPI,
  node: AnyNode,
  lines: string[],
  options: MarkdownOptions,
): void => {
  if (node.type === "text") {
    const text = squash($(node).text());
    if (text) lines.push(text);
    return;
  }

  const element = asElement(node);
  if (!element) return;

  const tag = element.tagName.toLowerCase();
  const selected = $(element);

  if (tag === "br") {
    lines.push("");
    return;
  }

  if (tag === "img") {
    if (options.hideImages) return;
    const label = labelOf($, element);
    if (label) lines.push(label);
    return;
  }

  if (HEADING_TAGS.has(tag)) {
    const text = squash(textOf($, selected, options));
    if (text) lines.push("", `${"#".repeat(Number(tag[1]))} ${text}`, "");
    return;
  }

  if (tag === "pre") {
    const code = selected.text().trim();
    if (code) lines.push("", "```", code, "```", "");
    return;
  }

  if (tag === "li") {
    const text = squash(textOf($, selected, options));
    if (text) lines.push(`- ${text}`);
    return;
  }

  if (tag === "tr") {
    const cells = selected
      .find("th, td")
      .toArray()
      .map((cell) => squash(textOf($, $(cell), options)))
      .filter(Boolean);
    if (cells.length) lines.push(`| ${cells.join(" | ")} |`);
    return;
  }

  if (tag === "table" || tag === "ul" || tag === "ol") {
    lines.push("");
    selected.contents().each((_, child) => renderNode($, child, lines, options));
    lines.push("");
    return;
  }

  const children = selected.contents().toArray();
  const hasBlockChild = children.some((child) => {
    const childElement = asElement(child);
    if (!childElement) return false;
    const childTag = childElement.tagName.toLowerCase();
    return (
      BLOCK_TAGS.has(childTag) ||
      HEADING_TAGS.has(childTag) ||
      ["ul", "ol", "table"].includes(childTag)
    );
  });

  if (!hasBlockChild) {
    const text = squash(textOf($, selected, options));
    if (text) lines.push(BLOCK_TAGS.has(tag) ? `${text}\n` : text);
    return;
  }

  for (const child of children) renderNode($, child, lines, options);
};

export const toMarkdown = (
  $: CheerioAPI,
  root: Cheerio<AnyNode>,
  options: MarkdownOptions = MARKDOWN_DEFAULTS,
): string => {
  const lines: string[] = [];
  root.contents().each((_, node) => renderNode($, node, lines, options));
  return lines.join("\n");
};
