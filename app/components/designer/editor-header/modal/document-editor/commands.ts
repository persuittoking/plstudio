import type { Editor, JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { pageStrings, type DocLang, type PageStrings } from "@/app/lib/document-i18n";
import { toTiptap } from "@/app/lib/document-tiptap";
import { normalizeIdentifier, type Schema } from "@/app/lib/schema";
import { editorStrings, type GroupId, type ItemId } from "./editor-i18n";

/**
 * Everything the Document editor can add, for the `/` menu and the Insert
 * button alike. Text elements turn the current empty line into themselves;
 * structural ones (tables, cards, diagrams, schema blocks, whole sections)
 * replace that line, or go after the current block when there is no empty one.
 */
export type InsertItem = {
  id: string;
  label: string;
  hint: string;
  /** Extra words the `/` filter matches: English terms and the item's name in every language. */
  keywords: string;
  run: (editor: Editor, schema: Schema) => void;
};

const empty = (rows: number, columns: number, headers: string[] = []): JSONContent => ({
  type: "table",
  content: Array.from({ length: rows }, (_, row) => ({
    type: "tableRow",
    content: Array.from({ length: columns }, (_, column) => ({
      type: row === 0 ? "tableHeader" : "tableCell",
      content: [{ type: "paragraph", content: row === 0 && headers[column] ? [{ type: "text", text: headers[column] }] : [] }],
    })),
  })),
});
const card = () => ({ type: "card", content: [{ type: "cardTitle" }, { type: "cardLead" }, { type: "cardText" }] });
const stat = () => ({ type: "stat", content: [{ type: "statValue" }, { type: "statTitle" }, { type: "cardText" }] });

/** An empty top-level paragraph at the cursor: this one if it already is one, otherwise a new one after the current block. */
function emptyLine(editor: Editor): number {
  const { $from } = editor.state.selection;
  if ($from.depth === 1 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) return $from.before(1);
  const after = $from.depth >= 1 ? $from.after(1) : editor.state.doc.content.size;
  editor.chain().insertContentAt(after, { type: "paragraph" }).run();
  return after;
}

/** Replaces the empty line with `content` and puts the cursor in the first place it can type. */
function place(editor: Editor, content: JSONContent[]) {
  const from = emptyLine(editor);
  const line = editor.state.doc.nodeAt(from);
  editor.chain().focus().insertContentAt({ from, to: from + (line?.nodeSize ?? 0) }, content).command(({ tr }) => {
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from + 1, tr.doc.content.size))));
    return true;
  }).run();
}

/** Turns the empty line into a text block of `type`. */
function become(editor: Editor, type: string, attrs?: Record<string, unknown>) {
  const from = emptyLine(editor);
  editor.chain().focus().setTextSelection(from + 1).setNode(type, attrs).run();
}

const firstTable = (schema: Schema) => (schema.tables[0] ? normalizeIdentifier(schema.tables[0].name) : "");
const section = (id: keyof PageStrings["sections"]) =>
  (editor: Editor, schema: Schema, lang: DocLang) => place(editor, toTiptap(pageStrings(lang).sections[id](schema)).content ?? []);
const schemaBlock = (kind: string) => (editor: Editor, schema: Schema) =>
  place(editor, [{ type: "schemaBlock", attrs: { kind, table: kind === "columns" ? firstTable(schema) : "" } }, { type: "paragraph" }]);

/** What each item does; the same in every language. Labels come from `editorStrings`. */
const ACTIONS: { group: GroupId; items: { id: ItemId; keywords: string; run: (editor: Editor, schema: Schema, lang: DocLang) => void }[] }[] = [
  { group: "text", items: [
    { id: "title", keywords: "title h1", run: (editor) => become(editor, "heading", { level: 1 }) },
    { id: "section", keywords: "section heading h2", run: (editor) => become(editor, "heading", { level: 2 }) },
    { id: "subsection", keywords: "subheading h3", run: (editor) => become(editor, "heading", { level: 3 }) },
    { id: "kicker", keywords: "kicker eyebrow", run: (editor) => become(editor, "kicker") },
    { id: "paragraph", keywords: "paragraph text", run: (editor) => become(editor, "paragraph") },
    { id: "note", keywords: "note muted", run: (editor) => become(editor, "note") },
    { id: "callout", keywords: "callout important key highlight", run: (editor) => become(editor, "callout") },
    { id: "bullets", keywords: "bullet list", run: (editor) => { become(editor, "paragraph"); editor.chain().focus().toggleBulletList().run(); } },
    { id: "numbers", keywords: "numbered ordered list steps", run: (editor) => { become(editor, "paragraph"); editor.chain().focus().toggleOrderedList().run(); } },
  ] },
  { group: "layout", items: [
    { id: "table", keywords: "table grid", run: (editor) => place(editor, [empty(3, 3)]) },
    { id: "cards", keywords: "cards keys", run: (editor) => place(editor, [{ type: "cards", content: [card(), card(), card()] }]) },
    { id: "stats", keywords: "stats numbers counts", run: (editor) => place(editor, [{ type: "stats", content: [stat(), stat(), stat()] }]) },
    { id: "divider", keywords: "divider rule line hr", run: (editor) => place(editor, [{ type: "horizontalRule" }, { type: "paragraph" }]) },
  ] },
  { group: "code", items: [
    { id: "code", keywords: "code sql plsql", run: (editor) => place(editor, [{ type: "codeBlock" }]) },
    { id: "diagram", keywords: "diagram flow mermaid flowchart", run: (editor, _schema, lang) => place(editor, [{ type: "diagram", attrs: { source: editorStrings(lang).flowSample } }, { type: "paragraph" }]) },
  ] },
  { group: "schema", items: [
    { id: "er", keywords: "er diagram schema", run: schemaBlock("er") },
    { id: "columns", keywords: "columns table", run: schemaBlock("columns") },
    { id: "tables", keywords: "all tables", run: schemaBlock("tables") },
    { id: "relationships", keywords: "relationships fk links", run: schemaBlock("relationships") },
  ] },
  { group: "sections", items: [
    { id: "s-intro", keywords: "intro title section", run: section("intro") },
    { id: "s-rule", keywords: "rule cards section", run: section("rule") },
    { id: "s-callout", keywords: "callout key takeaway important", run: section("callout") },
    { id: "s-er", keywords: "er section", run: section("er") },
    { id: "s-columns", keywords: "columns section", run: section("columns") },
    { id: "s-problem", keywords: "problem solution icon", run: section("problem") },
    { id: "s-logic", keywords: "logic checks button enabled", run: section("logic") },
    { id: "s-flow", keywords: "flow section path", run: section("flow") },
    { id: "s-seed", keywords: "seed sql merge", run: section("seed") },
    { id: "s-compare", keywords: "comparison compare v2 v3", run: section("compare") },
    { id: "s-findings", keywords: "findings numbers database", run: section("findings") },
    { id: "s-rollout", keywords: "rollout steps plan", run: section("rollout") },
    { id: "s-questions", keywords: "questions open", run: section("questions") },
    { id: "s-footnote", keywords: "footnote source", run: section("footnote") },
  ] },
];

const LANGS: DocLang[] = ["uz", "ru", "en"];

/** The menu in `lang`. An item also matches its name in the other languages, so a writer can type the word they know. */
export const insertGroups = (lang: DocLang): { group: string; items: InsertItem[] }[] =>
  ACTIONS.map(({ group, items }) => ({
    group: editorStrings(lang).groups[group],
    items: items.map(({ id, keywords, run }) => {
      const [label, hint] = editorStrings(lang).items[id];
      return {
        id,
        label,
        hint,
        keywords: [keywords, ...LANGS.map((other) => editorStrings(other).items[id][0])].join(" "),
        run: (editor: Editor, schema: Schema) => run(editor, schema, lang),
      };
    }),
  }));

export const filterItems = (query: string, lang: DocLang) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return insertGroups(lang)
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.group })))
    .filter((item) => words.every((word) => `${item.label} ${item.hint} ${item.keywords}`.toLowerCase().includes(word)))
    .slice(0, 40);
};
