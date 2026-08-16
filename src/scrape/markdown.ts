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

const squash = (value: string): string => value.replace(/[ \t]+/g, " ").trim();

const asElement = (node: AnyNode): Element | null =>
  node.type === "tag" ? (node as Element) : null;

const renderNode = ($: CheerioAPI, node: AnyNode, lines: string[]): void => {
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

  if (HEADING_TAGS.has(tag)) {
    const text = squash(selected.text());
    if (text) lines.push("", `${"#".repeat(Number(tag[1]))} ${text}`, "");
    return;
  }

  if (tag === "pre") {
    const code = selected.text().trim();
    if (code) lines.push("", "```", code, "```", "");
    return;
  }

  if (tag === "li") {
    const text = squash(selected.text());
    if (text) lines.push(`- ${text}`);
    return;
  }

  if (tag === "tr") {
    const cells = selected
      .find("th, td")
      .toArray()
      .map((cell) => squash($(cell).text()))
      .filter(Boolean);
    if (cells.length) lines.push(`| ${cells.join(" | ")} |`);
    return;
  }

  if (tag === "table" || tag === "ul" || tag === "ol") {
    lines.push("");
    selected.contents().each((_, child) => renderNode($, child, lines));
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
    const text = squash(selected.text());
    if (text) lines.push(BLOCK_TAGS.has(tag) ? `${text}\n` : text);
    return;
  }

  for (const child of children) renderNode($, child, lines);
};

export const toMarkdown = ($: CheerioAPI, root: Cheerio<AnyNode>): string => {
  const lines: string[] = [];
  root.contents().each((_, node) => renderNode($, node, lines));
  return lines.join("\n");
};
