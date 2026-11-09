"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Plugin } from "@tiptap/pm/state";
import { ListItem } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { LANGUAGE_LABELS, detectLanguage, lowlight } from "@/app/lib/code-highlight";
import { canvasDiagram, renderBlocks, type DocumentDiagram, type DocumentTheme } from "@/app/lib/documentation";
import type { DocLang } from "@/app/lib/document-i18n";
import { PRESET_COLORS, highlightBackground, isHexColor, type PresetColor } from "@/app/lib/doc-colors";
import { normalizeIdentifier, type Schema } from "@/app/lib/schema";
import { editorStrings } from "./editor-i18n";
import { renderMermaidDiagram } from "../mermaid-render";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The Document editor's vocabulary: Tiptap's paragraphs, headings, lists,
 * tables and code, plus the elements of an architecture note it does not have
 * -- a kicker line, a quiet note, badge marks, key cards and number cards, a
 * Mermaid diagram, and the blocks drawn from the schema. Each node's name and
 * shape is what `app/lib/document-tiptap.ts` converts to and from the stored
 * text, and each renders with the classes the exported page is styled by, so
 * the editor looks like the page.
 */

/* --------------------------------------------------------------- context */

export type EditorEnvironment = { schema: Schema; theme: DocumentTheme; readOnly: boolean; lang: DocLang };
/**
 * Kept on `globalThis` so a hot reload of this file reuses the same context:
 * a fresh one would leave the node views already on screen without a provider.
 */
const contextKey = Symbol.for("plstudio.document-editor.environment");
const holder = globalThis as typeof globalThis & { [contextKey]?: ReturnType<typeof createContext<EditorEnvironment | null>> };
export const EditorEnvironmentContext = (holder[contextKey] ??= createContext<EditorEnvironment | null>(null));
const EMPTY_SCHEMA: Schema = { id: "", name: "", revision: 0, schemaFormatVersion: 0, tables: [] };
const FALLBACK: EditorEnvironment = { schema: EMPTY_SCHEMA, theme: "light", readOnly: true, lang: "uz" };
/** Outside a provider (only for a moment, mid hot reload) the views draw read-only rather than crash. */
const useEnvironment = () => useContext(EditorEnvironmentContext) ?? FALLBACK;

/** Diagrams are slow to draw, so each source is drawn once per theme. */
const diagramCache = new Map<string, Promise<DocumentDiagram>>();
function useDiagram(source: string, theme: DocumentTheme) {
  const [state, setState] = useState<{ key: string; diagram?: DocumentDiagram; error?: string } | null>(null);
  const key = `${theme}\u0000${source}`;
  useEffect(() => {
    if (!source.trim()) return;
    let current = true;
    if (!diagramCache.has(key)) diagramCache.set(key, renderMermaidDiagram(source, theme));
    diagramCache.get(key)!.then(
      (diagram) => current && setState({ key, diagram }),
      (error: unknown) => { diagramCache.delete(key); if (current) setState({ key, error: error instanceof Error ? error.message.split("\n")[0] : "Could not draw this diagram." }); },
    );
    return () => { current = false; };
  }, [key, source, theme]);
  return state?.key === key ? state : null;
}

const DiagramFigure = ({ source, theme }: { source: string; theme: DocumentTheme }) => {
  const state = useDiagram(source, theme);
  const words = editorStrings(useEnvironment().lang).nodes;
  if (!source.trim()) return <figure className="diagram empty"><span className="muted">{words.emptyDiagram}</span></figure>;
  if (state?.error) return <figure className="diagram empty"><span className="warning">Mermaid: {state.error}</span></figure>;
  if (!state?.diagram) return <figure className="diagram empty"><span className="muted">{words.drawing}</span></figure>;
  const { markup, width, height } = state.diagram;
  return (
    <figure
      className="diagram"
      // Drawn locally by Mermaid with `securityLevel: "strict"`.
      dangerouslySetInnerHTML={{ __html: markup.replace(/^<svg\b/, `<svg width="${Math.ceil(width)}" height="${Math.ceil(height)}" style="max-width:${Math.ceil(width)}px"`) }}
    />
  );
};

/** The diagram as drawn on the canvas, redrawn whenever the schema or the theme changes. */
function CanvasFigure({ schema, theme }: { schema: Schema; theme: DocumentTheme }) {
  const { markup, width, height } = useMemo(() => canvasDiagram(schema, theme), [schema, theme]);
  return (
    <figure
      className="diagram er-figure"
      // Drawn locally from the schema by the Image export's renderer, with every value escaped.
      dangerouslySetInnerHTML={{ __html: markup.replace(/^<svg\b/, `<svg width="${Math.ceil(width)}" height="${Math.ceil(height)}" style="max-width:${Math.ceil(width)}px"`) }}
    />
  );
}

/* ----------------------------------------------------------------- marks */

export const Badge = Mark.create({
  name: "badge",
  excludes: "badge code",
  addAttributes: () => ({
    tone: {
      default: "",
      parseHTML: (element) => element.getAttribute("data-tone") ?? "",
      // A tone is good, bad, nothing (blue) or a colour code, drawn as the page draws it.
      renderHTML: (attributes) => (/^#[0-9a-f]{6}$/i.test(String(attributes.tone))
        ? { "data-tone": attributes.tone, class: "badge custom", style: `--badge:${attributes.tone}` }
        : { "data-tone": attributes.tone, class: `badge${attributes.tone ? ` ${attributes.tone}` : ""}` }),
    },
  }),
  parseHTML: () => [{ tag: "span.badge" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

/**
 * A marker-pen highlight for the words a reader should remember. Stored as
 * `==word==`, with `+`, `~` or `-` after the opening marks for green, blue or
 * pink.
 */
export const HIGHLIGHT_COLORS = PRESET_COLORS;
export type HighlightColor = PresetColor;

/** A theme colour is a class the page's palette paints; a colour code is painted as it is, as on the page. */
const colorAttributes = (base: string, color: string, property: "background" | "color") =>
  isHexColor(color)
    ? { "data-color": color, class: `${base} custom`, style: `${property}:${property === "background" ? highlightBackground(color) : color}` }
    : { "data-color": color, class: `${base} ${color}` };
export const Highlight = Mark.create({
  name: "highlight",
  excludes: "highlight code",
  addAttributes: () => ({
    color: {
      default: "yellow",
      parseHTML: (element) => element.getAttribute("data-color") ?? "yellow",
      renderHTML: (attributes) => colorAttributes("hl", attributes.color, "background"),
    },
  }),
  parseHTML: () => [{ tag: "mark" }],
  renderHTML: ({ HTMLAttributes }) => ["mark", HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name, { color: "yellow" }) };
  },
});

/** Coloured words, for terms that should stand out inside a sentence. Stored as `!!word!!`, coloured like the highlight. */
export const TextColor = Mark.create({
  name: "textColor",
  excludes: "textColor code",
  addAttributes: () => ({
    color: {
      default: "yellow",
      parseHTML: (element) => element.getAttribute("data-color") ?? "yellow",
      renderHTML: (attributes) => colorAttributes("tc", attributes.color, "color"),
    },
  }),
  parseHTML: () => [{ tag: "span.tc" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

/* ------------------------------------------------------- simple blocks */

const textBlock = (name: string, tag: string, className: string) =>
  Node.create({
    name,
    group: "block",
    content: "inline*",
    defining: true,
    parseHTML: () => [{ tag: `${tag}.${className}` }],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, { class: className }), 0],
  });

export const Kicker = textBlock("kicker", "p", "kicker");
/** A quiet side remark, in a colour of its own; none set is the page's default note colour. */
export const Note = Node.create({
  name: "note",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({
    color: {
      default: null,
      parseHTML: (element) => element.style.getPropertyValue("--note").trim() || null,
      renderHTML: (attributes) => (attributes.color ? { style: `--note:${attributes.color}` } : {}),
    },
  }),
  parseHTML: () => [{ tag: "p.note" }],
  renderHTML: ({ HTMLAttributes }) => ["p", mergeAttributes(HTMLAttributes, { class: "note" }), 0],
});
/** The point to remember, in one of four kinds: information (none), tip, warning or danger. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({
    tone: {
      default: "",
      parseHTML: (element) => (["tip", "warning", "danger"].find((tone) => element.classList.contains(`callout-${tone}`)) ?? ""),
      renderHTML: (attributes) => ({ class: `callout${attributes.tone ? ` callout-${attributes.tone}` : ""}` }),
    },
  }),
  parseHTML: () => [{ tag: "p.callout" }],
  renderHTML: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
});

/* --------------------------------------------------------------- cards */

const part = (name: string, tag: string, content: string, className?: string, marks?: string) =>
  Node.create({
    name,
    content,
    ...(marks !== undefined ? { marks } : {}),
    parseHTML: () => [{ tag: className ? `${tag}.${className}` : tag, priority: 60 }],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, className ? { class: className } : {}), 0],
  });

export const CardTitle = part("cardTitle", "h4", "inline*");
export const CardLead = part("cardLead", "p", "text*", "lead", "");
export const CardText = part("cardText", "p", "inline*", "card-text");
export const StatValue = part("statValue", "div", "text*", "value", "");
export const StatTitle = part("statTitle", "h4", "inline*", "stat-title");

const emptyCard = () => ({ type: "card", content: [{ type: "cardTitle" }, { type: "cardLead" }, { type: "cardText" }] });
const emptyStat = () => ({ type: "stat", content: [{ type: "statValue" }, { type: "statTitle" }, { type: "cardText" }] });

/** One card, with a remove button that only the editor shows. */
function CardView({ node, getPos, editor, deleteNode }: ReactNodeViewProps) {
  const { readOnly, lang } = useEnvironment();
  const words = editorStrings(lang).nodes;
  const remove = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    // The last card takes its row with it, so the group never ends up empty.
    const parent = editor.state.doc.resolve(pos).parent;
    if (parent.childCount === 1) editor.chain().focus().deleteRange({ from: pos - 1, to: pos - 1 + parent.nodeSize }).run();
    else deleteNode();
  };
  return (
    <NodeViewWrapper className="card editor-card">
      {!readOnly && (
        <span contentEditable={false} className="card-remove">
          <Button variant="ghost" size="icon-xs" aria-label={words.removeCard} onPress={remove}>
            <XIcon />
          </Button>
        </span>
      )}
      <NodeViewContent className="card-body" data-kind={node.type.name} />
    </NodeViewWrapper>
  );
}

/** A row of cards with an "add card" button after the last one. */
const cardGroupView = (stats: boolean) =>
  function CardGroupView({ node, getPos, editor }: ReactNodeViewProps) {
    const { readOnly, lang } = useEnvironment();
    const add = () => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      const end = pos + node.nodeSize - 1;
      editor.chain().focus().insertContentAt(end, stats ? emptyStat() : emptyCard()).setTextSelection(end + 2).run();
    };
    return (
      <NodeViewWrapper className="editor-cards">
        <NodeViewContent className={stats ? "cards stats" : "cards"} />
        {!readOnly && (
          <span contentEditable={false} className="editor-add-card block">
            <Button variant="outline" size="xs" onPress={add}>
              <PlusIcon data-icon="inline-start" />
              {editorStrings(lang).nodes.addCard}
            </Button>
          </span>
        )}
      </NodeViewWrapper>
    );
  };

export const Card = Node.create({
  name: "card",
  content: "cardTitle cardLead cardText+",
  isolating: true,
  parseHTML: () => [{ tag: "div.card" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "card" }), 0],
  addNodeView: () => ReactNodeViewRenderer(CardView),
});

export const Stat = Node.create({
  name: "stat",
  content: "statValue statTitle cardText+",
  isolating: true,
  parseHTML: () => [{ tag: "div.stat" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "card stat" }), 0],
  addNodeView: () => ReactNodeViewRenderer(CardView),
});

export const Cards = Node.create({
  name: "cards",
  group: "block",
  content: "card+",
  isolating: true,
  parseHTML: () => [{ tag: "div.cards" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "cards" }), 0],
  addNodeView: () => ReactNodeViewRenderer(cardGroupView(false)),
});

export const Stats = Node.create({
  name: "stats",
  group: "block",
  content: "stat+",
  isolating: true,
  parseHTML: () => [{ tag: "div.stats" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "cards stats" }), 0],
  addNodeView: () => ReactNodeViewRenderer(cardGroupView(true)),
});

/* -------------------------------------------------------------- diagram */

function DiagramView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { theme, readOnly, lang } = useEnvironment();
  const words = editorStrings(lang).nodes;
  const source = String(node.attrs.source ?? "");
  const [editing, setEditing] = useState(!source.trim());
  return (
    <NodeViewWrapper className={`editor-atom${selected ? " is-selected" : ""}`} contentEditable={false}>
      <div className="editor-atom-bar">
        <span>{words.diagram}</span>
        {!readOnly && (
          <Button variant="outline" size="xs" onPress={() => setEditing(!editing)}>
            <PencilIcon data-icon="inline-start" />
            {editing ? words.done : words.edit}
          </Button>
        )}
      </div>
      <DiagramFigure source={source} theme={theme} />
      {editing && !readOnly && (
        <div className="editor-diagram-source">
          <Textarea
            aria-label="Diagram code"
            className="field-sizing-fixed resize-y font-mono"
            value={source}
            spellCheck={false}
            rows={Math.min(14, Math.max(4, source.split("\n").length + 1))}
            onChange={(event) => updateAttributes({ source: event.target.value })}
            // The editor would otherwise take the keys (Enter, Backspace) as edits of its own.
            onKeyDown={(event) => event.stopPropagation()}
          />
          <p className="note">
            {words.diagramHelp[0]}: <code>A[Jadval] --&gt; B[Build]</code>. {words.diagramHelp[1]}: <code>B --&gt;|JS| C[onGridAction]</code>.
          </p>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const Diagram = Node.create({
  name: "diagram",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-diagram]", getAttrs: (element) => ({ source: (element as HTMLElement).getAttribute("data-source") ?? "" }) }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes({ "data-diagram": "", "data-source": HTMLAttributes.source })],
  addNodeView: () => ReactNodeViewRenderer(DiagramView),
});

/* --------------------------------------------------------- schema blocks */

export type SchemaBlockKind = "er" | "columns" | "tables" | "relationships";

function SchemaBlockView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { schema, theme, readOnly, lang } = useEnvironment();
  const words = editorStrings(lang).nodes;
  const kind = node.attrs.kind as SchemaBlockKind;
  const table = String(node.attrs.table ?? "");
  const known = schema.tables.some((item) => normalizeIdentifier(item.name) === normalizeIdentifier(table));
  return (
    <NodeViewWrapper className={`editor-atom${selected ? " is-selected" : ""}`} contentEditable={false}>
      <div className="editor-atom-bar">
        <span>{words.schema[kind]}</span>
        {kind === "columns" && (
          <Select aria-label="Table" selectedKey={table} isDisabled={readOnly} onSelectionChange={(key) => updateAttributes({ table: String(key) })}>
            <SelectTrigger size="sm" className="font-mono normal-case tracking-normal"><SelectValue /></SelectTrigger>
            <SelectContent className="code-menu"><SelectGroup>
              {!known && <SelectItem id={table}>{table || words.chooseTable}</SelectItem>}
              {schema.tables.map((item) => <SelectItem key={item.id} id={normalizeIdentifier(item.name)}>{normalizeIdentifier(item.name)}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
        )}
      </div>
      {kind === "er" ? (
        schema.tables.length ? <CanvasFigure schema={schema} theme={theme} /> : <p className="note">{words.noTables}</p>
      ) : (
        <div
          // Generated from the schema by the same renderer as the exported page, with every value escaped.
          dangerouslySetInnerHTML={{ __html: renderBlocks(schema, [kind === "columns" ? { type: "columns", table } : { type: kind }], new Map(), lang) }}
        />
      )}
    </NodeViewWrapper>
  );
}

export const SchemaBlock = Node.create({
  name: "schemaBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ kind: { default: "er" }, table: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-schema-block]", getAttrs: (element) => ({ kind: (element as HTMLElement).getAttribute("data-kind") ?? "er", table: (element as HTMLElement).getAttribute("data-table") ?? "" }) }],
  renderHTML: ({ HTMLAttributes }) => ["div", { "data-schema-block": "", "data-kind": HTMLAttributes.kind, "data-table": HTMLAttributes.table }],
  addNodeView: () => ReactNodeViewRenderer(SchemaBlockView),
});

/* ----------------------------------------------------------- code block */

/** The block names the language its code reads as; there is nothing to pick. */
function CodeView({ node }: ReactNodeViewProps) {
  const { lang } = useEnvironment();
  const language = String(node.attrs.language ?? "");
  return (
    <NodeViewWrapper className="editor-code">
      <span contentEditable={false} className="editor-code-language" aria-label="Language">
        {LANGUAGE_LABELS[language] ?? editorStrings(lang).nodes.code}
      </span>
      <pre className="code"><NodeViewContent<"code"> as="code" className="hljs" /></pre>
    </NodeViewWrapper>
  );
}

/**
 * Keeps each code block's `language` on what its code reads as, after every
 * edit, so the highlighting (which follows that attribute) and the label follow
 * the writer's typing. The change stays out of undo history: undoing a keystroke
 * should not take two steps.
 */
const CodeLanguage = CodeBlockLowlight.extend({
  addNodeView: () => ReactNodeViewRenderer(CodeView),
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        appendTransaction: (transactions, _, state) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const tr = state.tr;
          state.doc.descendants((node, position) => {
            if (node.type.name !== this.name) return;
            const language = detectLanguage(node.textContent) || null;
            if (node.attrs.language !== language) tr.setNodeMarkup(position, undefined, { ...node.attrs, language });
          });
          return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

/* ------------------------------------------------------------ the kit */


/** `lang` is read on every placeholder pass, so switching language relabels the empty fields without rebuilding the editor. */
export const documentExtensions = (lang: () => DocLang) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false,
    strike: false,
    underline: false,
    link: false,
    hardBreak: false,
    codeBlock: false,
    listItem: false,
    trailingNode: {},
  }),
  // A list item is one paragraph: the stored format has no nested lists.
  ListItem.extend({ content: "paragraph" }),
  CodeLanguage.configure({ lowlight, defaultLanguage: null }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader.extend({ content: "paragraph" }),
  TableCell.extend({ content: "paragraph" }),
  Badge,
  Kicker,
  Note,
  Callout,
  Highlight,
  TextColor,
  CardTitle, CardLead, CardText, StatValue, StatTitle, Card, Stat, Cards, Stats,
  Diagram,
  SchemaBlock,
  Placeholder.configure({
    includeChildren: true,
    showOnlyCurrent: false,
    placeholder: ({ node, editor, hasAnchor }) => {
      const words = editorStrings(lang()).placeholders;
      const byType: Record<string, string> = {
        cardTitle: words.cardTitle, cardLead: words.cardLead, cardText: words.cardText, statValue: words.statValue, statTitle: words.cardTitle,
        kicker: words.kicker, note: words.note, callout: words.callout,
      };
      if (byType[node.type.name]) return byType[node.type.name];
      if (node.type.name === "heading") return ["", words.title, words.section, words.subsection][Number(node.attrs.level)] ?? "";
      if (node.type.name !== "paragraph") return "";
      if (editor.isEmpty) return words.empty;
      // Only the line being typed in offers the menu, so empty lines elsewhere stay quiet.
      return hasAnchor ? words.line : "";
    },
  }),
];
