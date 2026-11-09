import type { JSONContent } from "@tiptap/core";
import { CALLOUT_SIGN, parseDocument, type CalloutTone, type DocBlock } from "@/app/lib/documentation";
import { detectLanguage } from "@/app/lib/code-highlight";
import { colorOfTone, markSource, toneBefore } from "@/app/lib/doc-colors";

/**
 * The bridge between the stored document text (`app/lib/documentation.ts`) and
 * the Tiptap editor's JSON. The text stays the saved form, so the preview, the
 * exports and a future AI writer are untouched; the editor only ever sees JSON.
 * Pure, so the round trip is tested without a browser.
 *
 * Node names are the editor's: `kicker`, `note`, `cards`/`card`, `stats`/`stat`,
 * `diagram` (Mermaid) and `schemaBlock` (`{{er}}`, `{{columns T}}`, …) are its
 * own extensions; the rest are Tiptap's.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };
export type BadgeTone = "" | "good" | "bad";

/* ------------------------------------------------------------ inline */

/** Highlight and word colours are a sign or a colour code after the opening marks (`app/lib/doc-colors.ts`). */
const INLINE = new RegExp([
  String.raw`\[\[(?<badgeTone>[+-]|\{#[0-9a-fA-F]{6}\})?(?<badge>[^\]]+)\]\]`,
  // Bold and italic together, as `inlineText` writes them; it has to come first, or `**` takes the inner pair.
  String.raw`\*\*\*(?<boldItalic>[^*]+)\*\*\*`,
  String.raw`\*\*(?<bold>[^*]+)\*\*`,
  String.raw`(?<![*\w])\*(?<italic>[^*\s][^*]*?)\*(?![*\w])`,
  markSource("==", { tone: "highlightTone", words: "highlight" }),
  markSource("!!", { tone: "colorTone", words: "color" }),
].join("|"), "g");
const text = (value: string, marks: Mark[] = []): JSONContent => (marks.length ? { type: "text", text: value, marks } : { type: "text", text: value });

/** The words inside a mark, read for marks of their own, with `marks` added to each. */
const withMark = (source: string, ...marks: Mark[]) => inlineNodes(source).map((node) => ({ ...node, marks: [...(node.marks ?? []), ...marks] }));

/** `code`, [[badges]], ==highlights==, !!coloured words!!, **bold** and *italic* as marked text nodes. */
export function inlineNodes(source: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  source.split(/(`[^`]+`)/).forEach((part) => {
    if (!part) return;
    if (/^`[^`]+`$/.test(part)) return void nodes.push(text(part.slice(1, -1), [{ type: "code" }]));
    let last = 0;
    for (const match of part.matchAll(INLINE)) {
      if (match.index > last) nodes.push(text(part.slice(last, match.index)));
      const group = match.groups!;
      if (group.badge !== undefined) nodes.push(text(group.badge, [{ type: "badge", attrs: { tone: group.badgeTone === "+" ? "good" : group.badgeTone === "-" ? "bad" : group.badgeTone?.startsWith("{") ? group.badgeTone.slice(1, -1).toLowerCase() : "" } }]));
      else if (group.boldItalic !== undefined) nodes.push(...withMark(group.boldItalic, { type: "italic" }, { type: "bold" }));
      else if (group.bold !== undefined) nodes.push(...withMark(group.bold, { type: "bold" }));
      else if (group.italic !== undefined) nodes.push(...withMark(group.italic, { type: "italic" }));
      else if (group.highlight !== undefined) nodes.push(...withMark(group.highlight, { type: "highlight", attrs: { color: colorOfTone(group.highlightTone) } }));
      else nodes.push(...withMark(group.color, { type: "textColor", attrs: { color: colorOfTone(group.colorTone) } }));
      last = match.index + match[0].length;
    }
    if (last < part.length) nodes.push(text(part.slice(last)));
  });
  return nodes;
}

const has = (node: JSONContent, type: string) => node.marks?.some((mark) => mark.type === type);

/** The reverse of `inlineNodes`: each text node back in the marks the parser reads. */
export function inlineText(nodes: JSONContent[] = []): string {
  return nodes.map((node) => {
    if (node.type === "hardBreak") return " ";
    let value = (node.text ?? "").replace(/\n/g, " ");
    if (!value) return "";
    if (has(node, "code")) return `\`${value.replace(/`/g, "'")}\``;
    const badge = node.marks?.find((mark) => mark.type === "badge");
    const tone = String(badge?.attrs?.tone ?? "");
    if (badge) value = `[[${tone === "good" ? "+" : tone === "bad" ? "-" : /^#[0-9a-f]{6}$/i.test(tone) ? `{${tone.toLowerCase()}}` : ""}${value.replace(/[[\]]/g, "")}]]`;
    const color = node.marks?.find((mark) => mark.type === "textColor");
    // A pair inside the words would close the mark early, so a run inside them is cut to one; a run at their end is fine.
    if (color) value = `!!${toneBefore(String(color.attrs?.color ?? "yellow"), value)}${value.replace(/!{2,}(?=[^!])/g, "!")}!!`;
    const highlight = node.marks?.find((mark) => mark.type === "highlight");
    if (highlight) value = `==${toneBefore(String(highlight.attrs?.color ?? "yellow"), value)}${value.replace(/={2,}(?=[^=])/g, "=")}==`;
    if (has(node, "italic")) value = `*${value}*`;
    if (has(node, "bold")) value = `**${value}**`;
    return value;
  }).join("").replace(/\*\*\*\*/g, "");
}

const plain = (nodes: JSONContent[] = []) => nodes.map((node) => node.text ?? "").join("");

/* ------------------------------------------------------- text -> json */

const paragraph = (value: string): JSONContent => ({ type: "paragraph", content: inlineNodes(value) });
const cell = (type: "tableHeader" | "tableCell", value: string): JSONContent => ({ type, content: [paragraph(value)] });
const isLead = (line: string) => /^`[^`]+`$/.test(line);

const toNode = (block: DocBlock): JSONContent => {
  switch (block.type) {
    case "kicker": return { type: "kicker", content: inlineNodes(block.text) };
    case "heading": return { type: "heading", attrs: { level: block.level }, content: inlineNodes(block.text) };
    case "paragraph": return paragraph(block.text);
    case "note": return { type: "note", attrs: { color: block.color || null }, content: inlineNodes(block.text) };
    case "callout": return { type: "callout", attrs: { tone: block.tone }, content: inlineNodes(block.text) };
    case "list": return {
      type: block.ordered ? "orderedList" : "bulletList",
      content: block.items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
    };
    case "table": return {
      type: "table",
      content: [
        { type: "tableRow", content: block.headers.map((header) => cell("tableHeader", header)) },
        ...block.rows.map((row) => ({ type: "tableRow", content: row.map((value) => cell("tableCell", value)) })),
      ],
    };
    case "code": return block.lang === "mermaid"
      ? { type: "diagram", attrs: { source: block.text } }
      : { type: "codeBlock", attrs: { language: detectLanguage(block.text) || null }, content: block.text ? [{ type: "text", text: block.text }] : [] };
    case "cards": return block.stats
      ? { type: "stats", content: block.cards.map(({ title, lines }) => {
          const [value, ...rest] = title.includes("|") ? title.split("|") : ["", title];
          return { type: "stat", content: [
            { type: "statValue", content: value.trim() ? [text(value.trim())] : [] },
            { type: "statTitle", content: inlineNodes(rest.join("|").trim()) },
            ...(lines.length ? lines : [""]).map((line) => ({ type: "cardText", content: inlineNodes(line) })),
          ] };
        }) }
      : { type: "cards", content: block.cards.map(({ title, lines }) => {
          const lead = lines[0] && isLead(lines[0]) ? lines[0].slice(1, -1) : "";
          const rest = lead ? lines.slice(1) : lines;
          return { type: "card", content: [
            { type: "cardTitle", content: inlineNodes(title) },
            { type: "cardLead", content: lead ? [text(lead)] : [] },
            ...(rest.length ? rest : [""]).map((line) => ({ type: "cardText", content: inlineNodes(line) })),
          ] };
        }) };
    case "rule": return { type: "horizontalRule" };
    case "er": case "tables": case "relationships": return { type: "schemaBlock", attrs: { kind: block.type, table: "" } };
    case "columns": return { type: "schemaBlock", attrs: { kind: "columns", table: block.table } };
  }
};

export function toTiptap(source: string): JSONContent {
  const content = parseDocument(source).map(toNode);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/* ------------------------------------------------------- json -> text */

/** A line the parser would read as the start of another block gets a zero-width space in front. */
const guard = (line: string) => (/^(#{1,3}(\s|$)|\^\s|!?>|```|:::|\||---\s*$|\{\{|\s*(?:[-*]|\d+[.)])\s)/.test(line) ? `​${line}` : line);
const tableCell = (node: JSONContent) => (node.content ?? []).map((child) => inlineText(child.content)).join(" ").replace(/\|/g, "\\|").trim() || " ";
const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body.replace(/^```/gm, "​```")}\n\`\`\``;
const field = (card: JSONContent, type: string) => (card.content ?? []).filter((child) => child.type === type);

function toBlockText(node: JSONContent): string {
  const inline = inlineText(node.content);
  switch (node.type) {
    case "kicker": return inline.trim() ? `^ ${inline}` : "";
    case "heading": return inline.trim() ? `${"#".repeat(Number(node.attrs?.level ?? 2))} ${inline}` : "";
    case "paragraph": return guard(inline.trim());
    case "note": return inline.trim() ? `>${node.attrs?.color ? `{${String(node.attrs.color).toLowerCase()}}` : ""} ${inline}` : "";
    case "callout": return inline.trim() ? `!>${CALLOUT_SIGN[(node.attrs?.tone ?? "") as CalloutTone] ?? ""} ${inline}` : "";
    case "bulletList": case "orderedList": return (node.content ?? [])
      .map((item) => (item.content ?? []).map((child) => inlineText(child.content)).join(" ").trim())
      .filter(Boolean)
      .map((item, index) => `${node.type === "orderedList" ? `${index + 1}.` : "-"} ${item}`)
      .join("\n");
    case "table": {
      const rows = (node.content ?? []).map((row) => (row.content ?? []).map(tableCell));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? " ").join(" | ")} |`;
      return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
    }
    // The fence names the language the code reads as; nobody picks it.
    case "codeBlock": return fence(detectLanguage(plain(node.content)), plain(node.content));
    case "diagram": return String(node.attrs?.source ?? "").trim() ? fence("mermaid", String(node.attrs?.source)) : "";
    case "cards": return [":::cards", ...(node.content ?? []).flatMap((card) => {
      const lead = plain(field(card, "cardLead")[0]?.content).trim();
      return [
        `### ${inlineText(field(card, "cardTitle")[0]?.content)}`.trimEnd(),
        ...(lead ? [`\`${lead.replace(/`/g, "'")}\``] : []),
        ...field(card, "cardText").map((line) => inlineText(line.content).trim()).filter(Boolean).map(cardLine),
      ];
    }), ":::"].join("\n");
    case "stats": return [":::stats", ...(node.content ?? []).flatMap((stat) => [
      `### ${plain(field(stat, "statValue")[0]?.content).trim()} | ${inlineText(field(stat, "statTitle")[0]?.content).trim()}`,
      ...field(stat, "cardText").map((line) => inlineText(line.content).trim()).filter(Boolean).map(cardLine),
    ]), ":::"].join("\n");
    case "horizontalRule": return "---";
    case "schemaBlock": return node.attrs?.kind === "columns" ? `{{columns ${String(node.attrs?.table ?? "").trim()}}}` : `{{${String(node.attrs?.kind ?? "er")}}}`;
    default: return guard(inline.trim());
  }
}

/** Inside a card a line must not read as a new card (`### `) or the end of the block (`:::`). */
const cardLine = (line: string) => (/^(#{1,3}(\s|$)|:::|`[^`]+`$)/.test(line) ? `​${line}` : line);

export function fromTiptap(doc: JSONContent): string {
  const text = (doc.content ?? []).map(toBlockText).filter((part) => part.trim()).join("\n\n");
  return text ? `${text}\n` : "";
}
