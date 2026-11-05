import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { tableColorsOf, tableNamedBy } from "@/app/lib/documentation";
import type { Schema } from "@/app/lib/schema";

/**
 * In the editor, a table named in code (`CORE_GRIDS`, `CORE_GRIDS(GRID_ID)`)
 * is drawn in the colour of its card, as it is on the page. The colour is a
 * decoration, not a mark: the text keeps only its code mark, so the stored
 * document does not change and renaming or recolouring a table follows at once.
 */
export const tableColorsKey = new PluginKey("tableColors");

export const TableColors = Extension.create<{ schema: () => Schema }>({
  name: "tableColors",
  addOptions: () => ({ schema: () => ({ tables: [] }) as unknown as Schema }),
  addProseMirrorPlugins() {
    const schema = this.options.schema;
    return [
      new Plugin({
        key: tableColorsKey,
        props: {
          decorations: (state) => {
            const colors = tableColorsOf(schema());
            if (!colors.size) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (!node.isText || !node.marks.some((mark) => mark.type.name === "code")) return;
              const color = tableNamedBy(node.text ?? "", colors);
              if (color) decorations.push(Decoration.inline(position, position + node.nodeSize, { class: "table-ref", style: `--table:${color}` }));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
