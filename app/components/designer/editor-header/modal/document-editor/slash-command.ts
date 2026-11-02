import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import type { InsertItem } from "./commands";

/**
 * Typing `/` on a line opens the insert menu; what follows filters it. The
 * plugin only reports state through `bridge`, and the React component that
 * owns the bridge draws the menu -- inside the dialog, where a click on it
 * cannot read as a click outside.
 */
export type SlashState = { items: InsertItem[]; rect: DOMRect | null; select: (item: InsertItem) => void };
export type SlashBridge = {
  open: (state: SlashState) => void;
  close: () => void;
  /** Arrow keys, Enter and Escape while the menu is open; true when handled. */
  key: (event: KeyboardEvent) => boolean;
  run: (editor: Editor, range: Range, item: InsertItem) => void;
  /** The items matching what was typed after `/`, in the document's current language. */
  filter: (query: string) => InsertItem[];
};

export const slashKey = new PluginKey("documentSlash");

export const SlashCommand = Extension.create<{ bridge: SlashBridge | null }>({
  name: "documentSlash",
  addOptions: () => ({ bridge: null }),
  addProseMirrorPlugins() {
    const bridge = this.options.bridge;
    if (!bridge) return [];
    const toState = (props: SuggestionProps<InsertItem>): SlashState => ({
      items: props.items,
      rect: props.clientRect?.() ?? null,
      select: (item) => props.command(item),
    });
    return [
      Suggestion<InsertItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: "/",
        // Only on a plain line: inside a table cell or a card the menu's blocks would not fit.
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.depth === 1 && $from.parent.type.name === "paragraph";
        },
        items: ({ query }) => bridge.filter(query),
        command: ({ editor, range, props }) => bridge.run(editor, range, props),
        render: () => ({
          onStart: (props) => bridge.open(toState(props)),
          onUpdate: (props) => bridge.open(toState(props)),
          onKeyDown: ({ event }) => bridge.key(event),
          onExit: () => bridge.close(),
        }),
      }),
    ];
  },
});
