import {
  currentTableColor,
  normalizeIdentifier,
  normalizeRelationships,
  type Column,
  type RelationshipConstraint,
  type Schema,
  type Table,
} from "@/app/lib/schema";
import { dialectOf, typeName } from "./dialect";
import { renderDiagramSVG } from "@/app/components/designer/diagram-svg";
import { LANGUAGE_LABELS, highlightCode } from "@/app/lib/code-highlight";
import { draftDocument } from "@/app/lib/document-draft";
import { colorOfTone, highlightBackground, isHexColor, markSource } from "@/app/lib/doc-colors";
import { DEFAULT_LANG, documentLanguage, pageStrings, versionText, type DocLang } from "@/app/lib/document-i18n";

/**
 * The diagram's written document: what the Export dialog's Document tab edits,
 * previews and downloads. The user writes Markdown -- headings, paragraphs,
 * lists, tables, code -- plus a few blocks of its own:
 *
 *     ^ CMS · dynamic grid          a small line above the title
 *     > text                        a note, in the default note colour;
 *     >{#hex} text                  …or in that colour
 *     !> text                       a callout: the point to remember (blue);
 *     !>+ / !>! / !>- text          …a tip (green), a warning (amber), a danger (red)
 *     ==word== ==+w== ==~w== ==-w== highlighted words: yellow, green, blue, pink
 *     !!word!! !!+w!! !!~w!! !!-w!! coloured words, in the same four colours
 *     {{lang ru}}                   the language of the document's own words
 *     :::cards / :::stats … :::     a row of cards, each opened by `### Title`
 *                                   (`### 21 | Title` in stats)
 *     [[BOR]] [[+YANGI]] [[-v2]]    badges: neutral, green, red
 *     ```mermaid                    a drawn diagram (a flowchart, say)
 *     {{er}}                        the ER diagram as drawn on the canvas
 *     {{columns TABLE}}             a table's Ustun | Tur | Qoida | Vazifasi
 *     {{tables}}                    that, for every table
 *     {{relationships}}             every relationship and its rules
 *
 * The `{{…}}` blocks are filled from the schema each time, so they never go
 * stale; everything else is the user's (later, an AI's) prose. Pure: Mermaid
 * needs a DOM, so the caller draws `diagramSources` and hands the results back.
 */

export type DocumentTheme = "light" | "dark";
/** A drawn diagram: a standalone `<svg viewBox=…>` with no width/height, and its natural size. */
export type DocumentDiagram = { markup: string; width: number; height: number };

type CardItem = { title: string; lines: string[] };
/** A callout's kind: none is information (blue). */
export type CalloutTone = "" | "tip" | "warning" | "danger";
/** The sign after `!>` for each kind, and back. */
export const CALLOUT_SIGNS: Record<string, CalloutTone> = { "+": "tip", "!": "warning", "-": "danger" };
export const CALLOUT_SIGN: Record<CalloutTone, string> = { "": "", tip: "+", warning: "!", danger: "-" };

export type DocBlock =
  | { type: "kicker"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "note"; color: string; text: string }
  | { type: "callout"; tone: CalloutTone; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "cards"; stats: boolean; cards: CardItem[] }
  | { type: "rule" }
  | { type: "er" }
  | { type: "columns"; table: string }
  | { type: "tables" }
  | { type: "relationships" };

const DIRECTIVE = /^\{\{\s*(er|tables|relationships|columns)(?:\s+([^}]+?))?\s*\}\}$/i;
const LIST_ITEM = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;
/** Cells split on `|`; a cell holds a literal pipe written as `\|`. */
const splitRow = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
const isSeparatorRow = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseDocument(source: string): DocBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DocBlock[] = [];
  let index = 0;
  const startsBlock = (line: string) =>
    !line.trim() || /^(#{1,3}\s|\^\s|!?>\s?|```|:::|\||---\s*$)/.test(line.trim()) || DIRECTIVE.test(line.trim()) || LIST_ITEM.test(line);

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { index++; continue; }
    // The language line belongs to the document, not to its content.
    if (/^\{\{\s*lang\s+\w+\s*\}\}$/i.test(trimmed)) { index++; continue; }

    const fence = trimmed.match(/^```\s*([\w-]*)/);
    if (fence) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) body.push(lines[index++]);
      index++;
      blocks.push({ type: "code", lang: fence[1].toLowerCase(), text: body.join("\n") });
      continue;
    }

    const container = trimmed.match(/^:::\s*(cards|stats)\s*$/i);
    if (container) {
      const cards: CardItem[] = [];
      index++;
      while (index < lines.length && lines[index].trim() !== ":::") {
        const inner = lines[index++].trim();
        const title = inner.match(/^#{1,3}(?:\s+(.*))?$/);
        if (title) cards.push({ title: title[1] ?? "", lines: [] });
        else if (inner) (cards.at(-1) ?? (cards.push({ title: "", lines: [] }), cards[0])).lines.push(inner);
      }
      index++;
      blocks.push({ type: "cards", stats: container[1].toLowerCase() === "stats", cards });
      continue;
    }

    const directive = trimmed.match(DIRECTIVE);
    if (directive) {
      const kind = directive[1].toLowerCase();
      blocks.push(kind === "columns" ? { type: "columns", table: (directive[2] ?? "").trim() } : { type: kind as "er" | "tables" | "relationships" });
      index++;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] }); index++; continue; }
    if (/^\^\s/.test(trimmed)) { blocks.push({ type: "kicker", text: trimmed.slice(1).trim() }); index++; continue; }
    if (/^---\s*$/.test(trimmed)) { blocks.push({ type: "rule" }); index++; continue; }

    if (trimmed.startsWith("!>")) {
      const tone = CALLOUT_SIGNS[trimmed[2]] ?? "";
      const body: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("!>")) body.push(lines[index++].trim().replace(/^!>[+!-]?\s?/, ""));
      blocks.push({ type: "callout", tone, text: body.join(" ") });
      continue;
    }

    if (trimmed.startsWith(">")) {
      // `>{#6366f1} text` is a note in that colour; a bare `>` is the default one.
      const color = trimmed.match(/^>\{(#[0-9a-fA-F]{6})\}/)?.[1].toLowerCase() ?? "";
      const body: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) body.push(lines[index++].trim().replace(/^>(\{#[0-9a-fA-F]{6}\})?\s?/, ""));
      blocks.push({ type: "note", color, text: body.join(" ") });
      continue;
    }

    if (trimmed.startsWith("|") && index + 1 < lines.length && isSeparatorRow(lines[index + 1])) {
      const headers = splitRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(splitRow(lines[index++]));
      blocks.push({ type: "table", headers, rows: rows.map((row) => headers.map((_, column) => row[column] ?? "")) });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = Boolean(item[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const next = lines[index].match(LIST_ITEM);
        if (next && Boolean(next[2]) === ordered) { items.push(next[3]); index++; continue; }
        // A wrapped line belongs to the item above it.
        if (next || !lines[index].trim() || startsBlock(lines[index]) || !/^\s/.test(lines[index])) break;
        items[items.length - 1] += ` ${lines[index++].trim()}`;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const body: string[] = [trimmed];
    index++;
    while (index < lines.length && !startsBlock(lines[index])) body.push(lines[index++].trim());
    blocks.push({ type: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

/** Every Mermaid source the document draws (its flow diagrams), so the caller can render them before `renderDocument`. */
export function diagramSources(_schema: Schema, blocks: DocBlock[]): string[] {
  return [...new Set(blocks.flatMap((block) => (block.type === "code" && block.lang === "mermaid" && block.text.trim() ? [block.text] : [])))];
}

/**
 * The ER diagram as the user drew it: the canvas's own layout, table colours,
 * groups and memos, from the same renderer as the Image export, with straight
 * lines that turn at right angles, as on the canvas. Pure, so it is
 * drawn on the spot rather than waiting on Mermaid; its fixed size is taken off
 * so the page can scale it, keeping the `viewBox`.
 */
export function canvasDiagram(schema: Schema, theme: DocumentTheme): DocumentDiagram {
  const svg = renderDiagramSVG(schema, { theme, edges: "straight", key: "bottom", background: CANVAS_BACKGROUND[theme] });
  const open = svg.match(/^<svg\b[^>]*>/)?.[0] ?? "<svg>";
  const size = (name: string) => Number(open.match(new RegExp(`\\s${name}="([\\d.]+)"`))?.[1] ?? 800);
  return { markup: svg.replace(open, open.replace(/\s(width|height)="[\d.]+"/g, "")), width: size("width"), height: size("height") };
}

/* ------------------------------------------------------------------ render */

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const HIGHLIGHT = new RegExp(markSource("=="), "g");
const COLORED = new RegExp(markSource("!!"), "g");
/** A theme colour is a class the page's palette paints; a colour code is painted as it is. */
const paint = (base: string, tone: string | undefined, property: "background" | "color") => {
  const color = colorOfTone(tone);
  if (!isHexColor(color)) return `class="${base} ${color}"`;
  return `class="${base} custom" style="${property}:${property === "background" ? highlightBackground(color) : color}"`;
};

/** `code`, **bold**, *italic*, [[badges]], ==highlights== and !!coloured words!!; code is cut out first so nothing inside it is formatted. */
/**
 * Table colours by normalized name, while a page is being drawn (`renderBlocks`
 * sets them for its one synchronous pass): a table named in code, `CORE_GRIDS`
 * or `CORE_GRIDS(GRID_ID)`, is drawn in the colour of its card on the canvas.
 */
let tableColors = new Map<string, string>();

export function tableColorsOf(schema: Pick<Schema, "tables">) {
  return new Map(schema.tables.flatMap((table) => {
    const color = currentTableColor(table.color).a;
    return /^#[0-9a-f]{6}$/i.test(color) ? [[normalizeIdentifier(table.name), color.toLowerCase()] as const] : [];
  }));
}

/** The table a piece of code names, if it names one: `T` or `T(COLUMN)`. */
export const tableNamedBy = (code: string, colors: Map<string, string>) => {
  const name = code.trim().match(/^([A-Za-z_$#][\w$#]*)(?:\s*\([^)]*\))?$/)?.[1];
  return name ? colors.get(normalizeIdentifier(name)) : undefined;
};

export function inline(text: string): string {
  return text.split(/(`[^`]+`)/).map((part) => {
    if (/^`[^`]+`$/.test(part)) {
      const color = tableNamedBy(part.slice(1, -1), tableColors);
      return color ? `<code class="table-ref" style="--table:${color}">${escape(part.slice(1, -1))}</code>` : `<code>${escape(part.slice(1, -1))}</code>`;
    }
    return escape(part)
      // [[x]] blue, [[+x]] green, [[-x]] red, [[{#ff8800}x]] in that colour.
      .replace(/\[\[([+-]|\{#[0-9a-fA-F]{6}\})?([^\]]+)\]\]/g, (_, tone: string | undefined, label: string) => tone?.startsWith("{")
        ? `<span class="badge custom" style="--badge:${tone.slice(1, -1).toLowerCase()}">${label}</span>`
        : `<span class="badge${tone === "+" ? " good" : tone === "-" ? " bad" : ""}">${label}</span>`)
      .replace(HIGHLIGHT, (_, tone: string | undefined, words: string) => `<mark ${paint("hl", tone, "background")}>${words}</mark>`)
      .replace(COLORED, (_, tone: string | undefined, words: string) => `<span ${paint("tc", tone, "color")}>${words}</span>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  }).join("");
}

const rule = (constraint: RelationshipConstraint) => constraint.toLowerCase();

/** The `Qoida` cell: everything the schema says about a column, in the order a reader checks it. */
export function columnRules(schema: Schema, table: Table, column: Column): string {
  const rel = (schema.relationships ?? []).find((item) => item.startTableId === table.id && item.fields.some((pair) => pair.startFieldId === column.id));
  const target = column.fk && schema.tables.find((item) => item.id === column.fk!.tableId);
  const targetColumn = target && target.columns.find((item) => item.id === column.fk!.columnId);
  return [
    column.pk && "PK",
    column.unique && !column.pk && "UK",
    column.fk && [
      `FK \`${normalizeIdentifier(target?.name ?? "?")}(${normalizeIdentifier(targetColumn?.name ?? "?")})\``,
      rel && rel.deleteConstraint !== "No action" && `on delete ${rule(rel.deleteConstraint)}`,
      rel && rel.updateConstraint !== "No action" && `on update ${rule(rel.updateConstraint)}`,
    ].filter(Boolean).join(" "),
    column.notNull && !column.pk && "NOT NULL",
    column.defaultValue.trim() && `default \`${column.defaultValue.trim()}\``,
    column.check.trim() && `check \`${column.check.trim()}\``,
  ].filter(Boolean).join(", ");
}

const htmlTable = (headers: string[], rows: string[][], className = "", color = "") =>
  `<div class="table${className ? ` ${className}` : ""}"${color ? ` style="--table:${color}"` : ""}><table><thead><tr>${headers.map((header) => `<th>${inline(header)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ? inline(cell) : `<span class="muted">—</span>`}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div>`;

const findTable = (schema: Schema, name: string) => schema.tables.find((table) => normalizeIdentifier(table.name) === normalizeIdentifier(name));

const columnsTable = (schema: Schema, table: Table, lang: DocLang) => htmlTable(
  pageStrings(lang).columnHeaders,
  table.columns.map((column) => [`\`${normalizeIdentifier(column.name)}\``, `\`${typeName(column, dialectOf(schema))}\``, columnRules(schema, table, column), column.comment?.trim() ?? ""]),
  "columns",
  tableColors.get(normalizeIdentifier(table.name)) ?? "",
);

const relationshipsTable = (schema: Schema, lang: DocLang) => {
  const name = (tableId: string, columnId: string) => {
    const table = schema.tables.find((item) => item.id === tableId);
    return `${normalizeIdentifier(table?.name ?? "?")}.${normalizeIdentifier(table?.columns.find((column) => column.id === columnId)?.name ?? "?")}`;
  };
  return htmlTable(
    pageStrings(lang).relationshipHeaders,
    (schema.relationships ?? []).map((rel) => [
      rel.name,
      rel.fields.map((pair) => `\`${name(rel.startTableId, pair.startFieldId)}\``).join(", "),
      rel.fields.map((pair) => `\`${name(rel.endTableId, pair.endFieldId)}\``).join(", "),
      pageStrings(lang).cardinality[rel.cardinality],
      rule(rel.deleteConstraint),
      rule(rel.updateConstraint),
    ]),
    "relationships",
  );
};

const diagramFigure = (diagram: DocumentDiagram | undefined, fallback: string, kind = "") => diagram
  ? `<figure class="diagram${kind ? ` ${kind}` : ""}">${diagram.markup.replace(/^<svg\b/, `<svg width="${Math.ceil(diagram.width)}" height="${Math.ceil(diagram.height)}" style="max-width:${Math.ceil(diagram.width)}px"`)}</figure>`
  : `<figure class="diagram empty"><span class="muted">${escape(fallback)}</span></figure>`;

const card = (item: CardItem, stats: boolean) => {
  const [value, title] = stats && item.title.includes("|") ? item.title.split("|").map((part) => part.trim()) : [null, item.title];
  const lines = item.lines.map((line) => /^`[^`]+`$/.test(line) ? `<p class="lead">${escape(line.slice(1, -1))}</p>` : `<p>${inline(line)}</p>`).join("");
  return `<div class="card">${value ? `<div class="value">${inline(value)}</div>` : ""}${title ? `<h4>${inline(title)}</h4>` : ""}${lines}</div>`;
};

export function renderBlocks(schema: Schema, blocks: DocBlock[], diagrams: Map<string, DocumentDiagram>, lang: DocLang = DEFAULT_LANG, theme: DocumentTheme = "light"): string {
  const previous = tableColors;
  tableColors = tableColorsOf(schema);
  try {
    return drawBlocks(schema, blocks, diagrams, lang, theme);
  } finally {
    tableColors = previous;
  }
}

function drawBlocks(schema: Schema, blocks: DocBlock[], diagrams: Map<string, DocumentDiagram>, lang: DocLang, theme: DocumentTheme): string {
  const canonical = normalizeRelationships(schema);
  const words = pageStrings(lang);
  return blocks.map((block) => {
    switch (block.type) {
      case "kicker": return `<p class="kicker">${inline(block.text)}</p>`;
      case "heading": return `<h${block.level}>${inline(block.text)}</h${block.level}>`;
      case "paragraph": return `<p>${inline(block.text)}</p>`;
      case "note": return `<p class="note"${block.color ? ` style="--note:${block.color}"` : ""}>${inline(block.text)}</p>`;
      case "callout": return `<p class="callout${block.tone ? ` callout-${block.tone}` : ""}">${inline(block.text)}</p>`;
      case "rule": return `<hr/>`;
      case "list": return `<${block.ordered ? "ol" : "ul"}>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`;
      case "table": return htmlTable(block.headers, block.rows);
      case "cards": return `<div class="cards${block.stats ? " stats" : ""}">${block.cards.map((item) => card(item, block.stats)).join("")}</div>`;
      case "code": return block.lang === "mermaid"
        ? diagramFigure(diagrams.get(block.text), words.drawing)
        : codeBlock(block.text, block.lang);
      case "er": return canonical.tables.length
        ? diagramFigure(canvasDiagram(canonical, theme), words.drawing, "er-figure")
        : `<p class="note">${escape(words.noTables)}</p>`;
      case "columns": {
        const table = findTable(canonical, block.table);
        return table ? columnsTable(canonical, table, lang) : `<p class="warning">${escape(words.missingTable)}: <code>${escape(block.table || "?")}</code></p>`;
      }
      case "tables": return canonical.tables.map((table) =>
        `<h3>${inline(words.columnsHeading(normalizeIdentifier(table.name)))}</h3>${table.comment?.trim() ? `<p>${inline(table.comment.trim())}</p>` : ""}${columnsTable(canonical, table, lang)}`).join("");
      case "relationships": return (canonical.relationships ?? []).length ? relationshipsTable(canonical, lang) : `<p class="note">${escape(words.noRelationships)}</p>`;
    }
  }).join("\n");
}

/* --------------------------------------------------------------- template */

/**
 * The first draft: written from the diagram by `draftDocument` (counts, key
 * rules, links, creation order, what to check), with the schema-driven blocks
 * in place, in `lang`'s words. The language line is the caller's to add.
 */
export const documentTemplate = (schema: Schema, lang: DocLang = DEFAULT_LANG) => draftDocument(schema, lang);

/* ------------------------------------------------------------------- page */

/** A code block, highlighted, with the language it reads as in its corner. */
const codeBlock = (text: string, hint: string) => {
  const { html, language } = highlightCode(text, hint);
  const label = LANGUAGE_LABELS[language];
  return `<pre class="code"${label ? ` data-lang="${label}"` : ""}><code class="hljs${language ? ` language-${language}` : ""}">${html}</code></pre>`;
};

/** Token colours for highlighted code, after GitHub's light and dark themes. */
const SYNTAX_VARS: Record<DocumentTheme, string> = {
  light: "--syn-keyword:#cf222e;--syn-string:#0a3069;--syn-number:#0550ae;--syn-comment:#6e7781;--syn-title:#8250df;--syn-type:#953800;--syn-tag:#116329",
  dark: "--syn-keyword:#ff7b72;--syn-string:#a5d6ff;--syn-number:#79c0ff;--syn-comment:#8b949e;--syn-title:#d2a8ff;--syn-type:#ffa657;--syn-tag:#7ee787",
};

/**
 * The page is drawn on the colour the diagram is drawn on in the app: `--canvas-surface` of globals.css
 * in light and dark, so an exported document looks like the canvas it was made on.
 */
export const CANVAS_BACKGROUND: Record<DocumentTheme, string> = { light: "#ffffff", dark: "#1c1c1e" };

const THEME_VARS: Record<DocumentTheme, string> = {
  light: "--bg:#ffffff;--text:#1f2328;--muted:#59636e;--panel:#f6f8fa;--border:#d1d9e0;--chip:#eff2f5;--code:#0550ae;--accent:#0969da;--good:#1a7f37;--good-bg:#dafbe1;--bad:#cf222e;--bad-bg:#ffebe9;--badge-bg:#ddf4ff;--warm:#bc4c00;--hl-yellow:#fff0a0;--hl-green:#c8f2d2;--hl-blue:#cfe7ff;--hl-pink:#ffd5e5;--callout-bg:#eef6ff;--note-default:#6366f1;--warn:#9a6700;--warn-bg:#fff8c5;--tc-yellow:#b45309;--tc-green:#15803d;--tc-blue:#1d4ed8;--tc-pink:#be185d",
  dark: "--bg:#1c1c1e;--text:#e6edf3;--muted:#8b949e;--panel:#242426;--border:#3a3a3c;--chip:#2c2c2e;--code:#79c0ff;--accent:#58a6ff;--good:#3fb950;--good-bg:#12351f;--bad:#f85149;--bad-bg:#3c1618;--badge-bg:#0c2d4d;--warm:#f0883e;--hl-yellow:rgba(250,204,21,.32);--hl-green:rgba(63,185,80,.32);--hl-blue:rgba(88,166,255,.32);--hl-pink:rgba(247,120,186,.32);--callout-bg:rgba(88,166,255,.10);--note-default:#818cf8;--warn:#d29922;--warn-bg:rgba(210,153,34,.12);--tc-yellow:#facc15;--tc-green:#4ade80;--tc-blue:#60a5fa;--tc-pink:#f472b6",
};

/** Scoped to `.doc` so the page renders the same inside an iframe, a file or an SVG `foreignObject`. */
export const documentCss = (theme: DocumentTheme) => `
.doc{${THEME_VARS[theme]};${SYNTAX_VARS[theme]};box-sizing:border-box;background:var(--bg);color:var(--text);font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:48px 40px 56px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc *{box-sizing:border-box}
.doc .page{max-width:860px;margin:0 auto}
.doc h1{font-size:30px;line-height:1.25;margin:4px 0 14px;font-weight:750;letter-spacing:-.01em}
.doc h2{font-size:21px;line-height:1.3;margin:40px 0 14px;font-weight:700}
.doc h3{font-size:17px;line-height:1.35;margin:30px 0 10px;font-weight:700}
.doc h4{font-size:15px;margin:0 0 6px;font-weight:700;overflow-wrap:anywhere}
.doc p{margin:0 0 14px}
.doc .kicker{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.doc .note{--note:var(--note-default);font-size:14px;color:var(--text);background:color-mix(in srgb,var(--note) 9%,transparent);border-left:3px solid var(--note);border-radius:0 8px 8px 0;padding:8px 14px;margin:0 0 14px}
.doc .callout{background:var(--callout-bg);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-left:4px solid var(--accent);border-radius:8px;padding:12px 16px;font-size:15.5px;font-weight:500;margin:4px 0 18px}
/* Kinds are prefixed: .warning is already the missing-block message. */
.doc .callout-tip{--accent:var(--good);--callout-bg:var(--good-bg)}.doc .callout-warning{--accent:var(--warn);--callout-bg:var(--warn-bg)}.doc .callout-danger{--accent:var(--bad);--callout-bg:var(--bad-bg)}
.doc mark.hl{color:inherit;border-radius:4px;padding:0 3px;margin:0 -1px;font-weight:600;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.doc .tc{font-weight:600}.doc .tc.yellow{color:var(--tc-yellow)}.doc .tc.green{color:var(--tc-green)}.doc .tc.blue{color:var(--tc-blue)}.doc .tc.pink{color:var(--tc-pink)}
.doc mark.hl.yellow{background:var(--hl-yellow)}.doc mark.hl.green{background:var(--hl-green)}.doc mark.hl.blue{background:var(--hl-blue)}.doc mark.hl.pink{background:var(--hl-pink)}
.doc .muted{color:var(--muted)}
.doc .warning{font-size:13px;color:var(--bad);background:var(--bad-bg);border-radius:6px;padding:8px 12px}
.doc code{font:.86em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--chip);color:var(--code);border-radius:4px;padding:1px 5px}
.doc h3 code,.doc h2 code{color:var(--text)}
.doc pre{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;padding:14px 16px;margin:0 0 16px;white-space:pre-wrap;word-break:break-word}
.doc pre code{background:none;padding:0;color:var(--text);font-size:13px;line-height:1.6}
.doc pre.code{position:relative}
.doc pre.code[data-lang]{padding-top:30px}
.doc pre.code[data-lang]::before{content:attr(data-lang);position:absolute;top:8px;right:12px;font:600 10.5px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.doc .hljs-keyword,.doc .hljs-selector-tag,.doc .hljs-doctag,.doc .hljs-meta .hljs-keyword{color:var(--syn-keyword)}
.doc .hljs-string,.doc .hljs-regexp,.doc .hljs-meta .hljs-string{color:var(--syn-string)}
.doc .hljs-number,.doc .hljs-literal,.doc .hljs-attr,.doc .hljs-attribute,.doc .hljs-property,.doc .hljs-variable.language_,.doc .hljs-selector-attr,.doc .hljs-selector-class,.doc .hljs-selector-id{color:var(--syn-number)}
.doc .hljs-comment,.doc .hljs-quote,.doc .hljs-meta{color:var(--syn-comment);font-style:italic}
.doc .hljs-title,.doc .hljs-title.function_,.doc .hljs-section{color:var(--syn-title)}
.doc .hljs-type,.doc .hljs-built_in,.doc .hljs-title.class_,.doc .hljs-variable,.doc .hljs-template-variable,.doc .hljs-params{color:var(--syn-type)}
.doc .hljs-tag,.doc .hljs-name,.doc .hljs-selector-pseudo{color:var(--syn-tag)}
.doc ul,.doc ol{margin:0 0 16px;padding-left:24px}
.doc ul{list-style:disc}.doc ol{list-style:decimal}
.doc li{margin:0 0 8px}
.doc hr{border:0;border-top:1px solid var(--border);margin:32px 0}
.doc strong{font-weight:700}
.doc .badge{display:inline-block;font:700 11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:0 6px;border-radius:4px;background:var(--badge-bg);color:var(--accent);vertical-align:1px}
.doc .badge.good{background:var(--good-bg);color:var(--good)}
.doc .badge.bad{background:var(--bad-bg);color:var(--bad)}
.doc .badge.custom{background:color-mix(in srgb,var(--badge) 16%,transparent);color:var(--badge)}
.doc .table{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin:0 0 18px}
.doc table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.5}
.doc th{background:var(--panel);color:var(--muted);text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;padding:9px 12px}
.doc td{padding:9px 12px;border-top:1px solid var(--border);vertical-align:top}
.doc td code{overflow-wrap:anywhere}
.doc .relationships td:nth-child(4){white-space:nowrap}
.doc .columns table{table-layout:fixed}
.doc .table.columns[style]{border-top:3px solid var(--table)}
.doc code.table-ref,.doc span.table-ref{background:color-mix(in srgb,var(--table) 24%,transparent)!important;color:var(--text)!important;font-weight:650;border-radius:4px}
.doc span.table-ref{padding:1px 5px}
.doc code:has(>span.table-ref){background:none!important;padding:0}
.doc .columns th:nth-child(1){width:22%}.doc .columns th:nth-child(2){width:15%}.doc .columns th:nth-child(3){width:30%}
.doc .columns td:first-child code,.doc .columns td:nth-child(2) code{overflow-wrap:anywhere}
.doc .columns td:first-child code,.doc .columns td:nth-child(2) code{background:none;padding:0;color:var(--text)}
.doc .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:0 0 20px}
.doc .card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 14px 4px}
.doc .card p{font-size:13px;color:var(--muted);margin:0 0 10px}
.doc .card .lead{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--code);margin:0 0 8px;overflow-wrap:anywhere}
.doc .stats .value{font:700 24px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--warm);margin:0 0 6px}
.doc .diagram{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:16px;margin:0 0 16px;text-align:center}
.doc .diagram svg{width:100%;height:auto;display:inline-block}
.doc .diagram.er-figure{padding:0;overflow:hidden}
/* The ER diagram fills the page, however wide: larger in a wide export, smaller on a narrow page. Flowcharts keep their own size. */
.doc .diagram.er-figure svg{max-width:none!important;display:block}
.doc .diagram.empty{padding:40px 16px}
.doc .footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
@page{margin:12mm}
@media print{.doc{padding:0}}`;

export type RenderedDocument = { css: string; body: string; title: string; lang: DocLang };

/** Renders one language's version: `lang`, or the one the document opens in. */
export function renderDocument(schema: Schema, source: string, { theme, diagrams, generatedAt, lang: wanted }: { theme: DocumentTheme; diagrams: Map<string, DocumentDiagram>; generatedAt: string; lang?: DocLang }): RenderedDocument {
  const lang = wanted ?? documentLanguage(source);
  const blocks = parseDocument(versionText(source, lang));
  const title = blocks.find((block): block is Extract<DocBlock, { type: "heading" }> => block.type === "heading" && block.level === 1)?.text.replace(/[`*[\]=]/g, "") || schema.name;
  const body = `<div class="doc" lang="${lang}"><div class="page">${renderBlocks(schema, blocks, diagrams, lang, theme)}<p class="footer">${escape(schema.name)} · ${escape(generatedAt)}</p></div></div>`;
  return { css: documentCss(theme), body, title, lang };
}

/** A standalone HTML file of the rendered document. */
export const documentHtmlFile = ({ css, body, title, lang }: RenderedDocument) =>
  `<!doctype html>\n<html lang="${lang}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escape(title)}</title><style>html,body{margin:0}${css}</style></head><body>${body}</body></html>`;
