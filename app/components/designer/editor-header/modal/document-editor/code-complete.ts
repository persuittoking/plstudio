import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { collectWords, completions, type CompletionItem } from "@/app/lib/code-complete";
import { detectLanguage } from "@/app/lib/code-highlight";
import type { Schema } from "@/app/lib/schema";

/**
 * Autocomplete inside code blocks. Typing a word opens a list of what it could
 * become (`app/lib/code-complete.ts` decides what); Tab writes the chosen one,
 * the arrows move through the list and Escape closes it. Enter keeps its
 * meaning in code, a new line. The list itself is drawn by `CompletionMenu`
 * from this plugin's state.
 */
export type CompletionState = { items: CompletionItem[]; index: number; from: number; to: number } | null;
type Meta = { type: "move"; index: number } | { type: "close" };

export const completionKey = new PluginKey<CompletionState>("codeCompletion");

/** The identifiers a document's code already uses: its code blocks and inline code. */
const wordsCache = new WeakMap<ProseMirrorNode, string[]>();
function documentWords(doc: ProseMirrorNode) {
  const cached = wordsCache.get(doc);
  if (cached) return cached;
  const code: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "codeBlock") { code.push(node.textContent); return false; }
    if (node.isText && node.marks.some((mark) => mark.type.name === "code")) code.push(node.text ?? "");
    return true;
  });
  const words = collectWords(code.join("\n"));
  wordsCache.set(doc, words);
  return words;
}

function compute(state: EditorState, schema: Schema): CompletionState {
  const { selection } = state;
  if (!selection.empty || selection.$from.parent.type.name !== "codeBlock") return null;
  const block = selection.$from.parent;
  const before = block.textBetween(0, selection.$from.parentOffset, "\n");
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const items = completions(line, { schema, words: documentWords(state.doc), language: detectLanguage(block.textContent) });
  if (!items.length) return null;
  const prefix = line.match(/[\w$#]*$/)?.[0] ?? "";
  return { items, index: 0, from: selection.from - prefix.length, to: selection.from };
}

/** Writes item `index` of the open list over the word being typed. */
export function acceptCompletion(view: EditorView, index?: number) {
  const state = completionKey.getState(view.state);
  if (!state) return false;
  const item = state.items[index ?? state.index];
  if (!item) return false;
  view.dispatch(view.state.tr.insertText(item.insert, state.from, state.to).setMeta(completionKey, { type: "close" } satisfies Meta));
  view.focus();
  return true;
}

export const CodeCompletion = Extension.create<{ schema: () => Schema }>({
  name: "codeCompletion",
  addOptions: () => ({ schema: () => ({ tables: [] }) as unknown as Schema }),
  addProseMirrorPlugins() {
    const schema = this.options.schema;
    return [
      new Plugin<CompletionState>({
        key: completionKey,
        state: {
          init: () => null,
          apply: (tr, previous, _, next) => {
            const meta = tr.getMeta(completionKey) as Meta | undefined;
            if (meta?.type === "close") return null;
            if (meta?.type === "move") return previous && { ...previous, index: meta.index };
            // The list opens on typing; moving the cursor alone closes it.
            if (!tr.docChanged) return tr.selectionSet ? null : previous;
            return compute(next, schema());
          },
        },
        props: {
          handleKeyDown: (view, event) => {
            const state = completionKey.getState(view.state);
            if (!state) return false;
            const count = state.items.length;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const index = (state.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
              view.dispatch(view.state.tr.setMeta(completionKey, { type: "move", index } satisfies Meta));
              return true;
            }
            if (event.key === "Tab" && !event.shiftKey) {
              event.stopPropagation(); // the dialog's focus trap would otherwise move focus on
              return acceptCompletion(view);
            }
            if (event.key === "Escape") {
              event.stopPropagation(); // closes the list, not the dialog around the editor
              view.dispatch(view.state.tr.setMeta(completionKey, { type: "close" } satisfies Meta));
              return true;
            }
            return false;
          },
          handleDOMEvents: { blur: (view) => { if (completionKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(completionKey, { type: "close" } satisfies Meta)); return false; } },
        },
      }),
    ];
  },
});
