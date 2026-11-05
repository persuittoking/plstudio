import { SHORTCUTS, type ShortcutId } from "./shortcuts";
import { dialectOf, typeName } from "./dialect";
import { BUILTIN_COLUMN_TEMPLATES, type Schema } from "./schema";

/**
 * What the ⌘K palette offers, and in what order. Commands come straight from
 * the shortcut table, so the palette, the menus and the chords run the same
 * closures and can never disagree about what exists.
 *
 * Pure by design -- no React, no DOM.
 */

export type PaletteItem =
  | { kind: "command"; id: string; label: string; detail: string; shortcut: ShortcutId }
  | { kind: "table"; id: string; label: string; detail: string; tableId: string }
  | { kind: "column"; id: string; label: string; detail: string; tableId: string; columnId: string }
  | { kind: "template"; id: string; label: string; detail: string; tableId: string; templateId: string };

/**
 * Chords that mean nothing as a click: the Space hold, paste (which needs the
 * browser's own paste event to read the clipboard) and the palette itself.
 */
const NOT_RUNNABLE = new Set<ShortcutId>(["panCanvas", "pasteSelection", "commandPalette"]);

export function paletteItems(schema: Schema, { readOnly, selectedTableId }: { readOnly: boolean; selectedTableId?: string | null }): PaletteItem[] {
  const commands = SHORTCUTS.filter((shortcut) => !NOT_RUNNABLE.has(shortcut.id) && !(readOnly && shortcut.mutating)).map(
    (shortcut): PaletteItem => ({ kind: "command", id: `command:${shortcut.id}`, label: shortcut.label, detail: shortcut.group, shortcut: shortcut.id }),
  );
  const selected = !readOnly && schema.tables.find((table) => table.id === selectedTableId);
  const templates = selected
    ? [...BUILTIN_COLUMN_TEMPLATES, ...(schema.columnTemplates ?? [])].map(
        (template): PaletteItem => ({ kind: "template", id: `template:${template.id}`, label: `Insert ${template.name}`, detail: `into ${selected.name}`, tableId: selected.id, templateId: template.id }),
      )
    : [];
  const tables = schema.tables.map((table): PaletteItem => ({ kind: "table", id: `table:${table.id}`, label: table.name, detail: `${table.columns.length} columns`, tableId: table.id }));
  const columns = schema.tables.flatMap((table) =>
    table.columns.map((column): PaletteItem => ({ kind: "column", id: `column:${column.id}`, label: `${table.name}.${column.name}`, detail: typeName(column, dialectOf(schema)), tableId: table.id, columnId: column.id })),
  );
  return [...commands, ...templates, ...tables, ...columns];
}

/**
 * How well `query` matches `label`, or `null` for no match. A contiguous
 * substring beats a scattered subsequence, a match at the start (of the label
 * or of a word) beats one in the middle, and a shorter label wins a tie --
 * `ORDERS` should outrank `ORDERS_ARCHIVE` for "orders".
 */
export function matchScore(label: string, query: string): number | null {
  const haystack = label.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const at = haystack.indexOf(needle);
  if (at >= 0) {
    const wordStart = at === 0 || /[\s._-]/.test(haystack[at - 1]);
    return 1000 - at + (at === 0 ? 500 : wordStart ? 200 : 0) - haystack.length;
  }
  let from = 0;
  let gaps = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, from);
    if (found < 0) return null;
    gaps += found - from;
    from = found + 1;
  }
  return 500 - gaps - haystack.length;
}

/**
 * With no query, the commands and tables only: listing every column of a large
 * diagram before anything is typed buries the commands. With one, everything
 * that matches, best first; the sort is stable, so equal scores keep the
 * order `paletteItems` gave them (commands before tables before columns).
 */
export function rankPaletteItems(items: PaletteItem[], query: string, limit = 50): PaletteItem[] {
  if (!query.trim()) return items.filter((item) => item.kind !== "column").slice(0, limit);
  return items
    .flatMap((item) => {
      const score = matchScore(item.label, query);
      return score === null ? [] : [{ item, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
