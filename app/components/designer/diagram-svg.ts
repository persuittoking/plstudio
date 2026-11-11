import {
  COMMENT_LINE_HEIGHT,
  COMMENT_PADDING,
  DOCUMENT_HEADER_HEIGHT,
  GROUP_PALETTE,
  TABLE_FIELD_HEIGHT,
  commentLines,
  inkOn,
  normalizeRelationships,
  tableHeaderHeight,
  tableHeight,
  tableWidth,
  uniqueGroupColumnIds,
  wrapText,
  type MemoColor,
  type Schema,
  type SchemaGroup,
  type Table,
} from "@/app/lib/schema";
import { dialectOf, typeName } from "@/app/lib/dialect";
import { CROW_MANY, CROW_MARKER_SIZE, CROW_ONE, crowMarker, curvePath, edgePath, facingSide, fanPorts, idealBend, routeEdges } from "./edge-routing";
import { relationshipCardinalities } from "./geometry";

/**
 * The diagram as a standalone SVG document, drawn from the domain model rather
 * than screenshotted from the DOM: the canvas is transformed, culled with
 * `content-visibility` and themed through custom properties, none of which
 * survives serialization.
 *
 * It is always the *document* card style -- a printed ERD: colour-filled
 * headers, the table comment under them, monospace columns with PK/FK/UQ
 * badges, curved relationships with crow's-foot ends, and a title, summary
 * and legend above it. Positions are the canvas's, reflowed only where a
 * taller document card would otherwise run into the one below it
 * (`reflowDiagram`). Pure and deterministic; `svgToPng` rasterizes it.
 */
export type DiagramTheme = "light" | "dark";

const THEMES = {
  light: {
    background: "#ffffff", card: "#ffffff", text: "#0f172a", muted: "#64748b", rule: "#eef2f6", edge: "#2563eb",
    pk: ["#fef3c7", "#b45309"], fk: ["#dbeafe", "#2563eb"], uq: ["#ede9fe", "#7c3aed"],
  },
  dark: {
    background: "#0f1115", card: "#1a1d23", text: "#f1f5f9", muted: "#94a3b8", rule: "#262a31", edge: "#60a5fa",
    pk: ["#422006", "#fbbf24"], fk: ["#172554", "#60a5fa"], uq: ["#2e1065", "#a78bfa"],
  },
} as const;

const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const PADDING = 48;
/** Rough advances: a 13px sans glyph, and an 11.5px monospace one. */
const CHAR_WIDTH = 7.4;
const MONO_WIDTH = 6.9;
/** Room above the diagram for the title, summary and legend (the image export). */
const CHROME_HEIGHT = 64;
/** Room below the diagram for its key (the Document's figure): one row, or two when the diagram is narrow. */
const LEGEND_ROW = 40;
/** A group's name sits above its box, as the heading of its lane. */
const LANE_TITLE_HEIGHT = 26;

export const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

const fit = (text: string, width: number, charWidth = CHAR_WIDTH) => {
  const max = Math.max(1, Math.floor(width / charWidth));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The memo tokens of globals.css as literals. The canvas resolves `var(--memo-…)`
 * against the page's stylesheet; an exported file has none, and an unresolvable
 * `fill` paints black.
 */
const MEMO_SWATCHES: Record<MemoColor, { surface: string; edge: string }> = {
  yellow: { surface: "#f4efdc", edge: "#a88d19" },
  green: { surface: "#e3f4e6", edge: "#4ea464" },
  blue: { surface: "#e0f1fe", edge: "#3598d4" },
  pink: { surface: "#fee8ef", edge: "#ca6c93" },
};
const MEMO_INK = "#322c28";
const MEMO_LINE = 18;

type Box = { x: number; y: number; width: number; height: number };
type Block = { id: string; x: number; y: number; width: number; before: number; after: number };

/**
 * New tops for blocks that may each have grown. A block sitting clear below
 * another it shares columns with keeps the gap it had, measured from that
 * block's new bottom; blocks that already overlapped are left alone -- the user
 * put them there. One pass in top-to-bottom order, so growth cascades.
 */
export function pushDown(blocks: Block[]) {
  const placed: (Block & { top: number })[] = [];
  const tops = new Map<string, number>();
  [...blocks]
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1))
    .forEach((block) => {
      const top = placed.reduce((lowest, other) => {
        const shareColumns = block.x < other.x + other.width && other.x < block.x + block.width;
        const gap = block.y - (other.y + other.before);
        return shareColumns && gap >= 0 ? Math.max(lowest, other.top + other.after + gap) : lowest;
      }, block.y);
      tops.set(block.id, top);
      placed.push({ ...block, top });
    });
  return tops;
}

/**
 * Where everything sits in the export. Document cards run taller than classic
 * ones by their comment block, so positions laid out on a classic canvas are
 * reflowed: first each group's members -- its tables *and* its memos -- among
 * themselves, growing the group to keep its bottom margin, then the groups and
 * whatever belongs to none as blocks, a moved group carrying its members. The
 * canvas is never touched.
 */
export function reflowDiagram(schema: Schema) {
  const groups = schema.groups ?? [];
  const groupIds = new Set(groups.map((group) => group.id));
  const memos = schema.memos ?? [];
  const blocks: (Block & { schemaId?: string })[] = [
    ...schema.tables.map((item) => ({ id: item.id, schemaId: item.schemaId, x: item.x, y: item.y, width: tableWidth(item), before: tableHeight(item, "classic"), after: tableHeight(item, "document") })),
    ...memos.map((memo) => ({ id: memo.id, schemaId: memo.schemaId, x: memo.x, y: memo.y, width: memo.width, before: memo.height, after: memo.height })),
  ];
  /** Every table's and memo's top, as it will be drawn. */
  const at = new Map(blocks.map((item) => [item.id, item.y]));

  const grown = new Map<string, SchemaGroup>();
  groups.forEach((group) => {
    const members = blocks.filter((item) => item.schemaId === group.id);
    pushDown(members).forEach((top, id) => at.set(id, top));
    const bottom = (items: number[]) => Math.max(group.y, ...items);
    const margin = Math.max(0, group.y + group.height - bottom(members.map((item) => item.y + item.before)));
    const reach = bottom(members.map((item) => at.get(item.id)! + item.after));
    grown.set(group.id, { ...group, height: Math.max(group.height, reach + margin - group.y) });
  });

  const loose = blocks.filter((item) => !groupIds.has(item.schemaId ?? ""));
  const tops = pushDown([
    ...groups.map((group) => ({ id: group.id, x: group.x, y: group.y, width: group.width, before: group.height, after: grown.get(group.id)!.height })),
    ...loose,
  ]);
  loose.forEach((item) => at.set(item.id, tops.get(item.id)!));
  groups.forEach((group) => {
    const dy = tops.get(group.id)! - group.y;
    grown.get(group.id)!.y += dy;
    blocks.filter((item) => item.schemaId === group.id).forEach((item) => at.set(item.id, at.get(item.id)! + dy));
  });
  return {
    tables: new Map(schema.tables.map((item) => [item.id, { x: item.x, y: at.get(item.id)! }])),
    groups: groups.map((group) => grown.get(group.id)!),
    memos: memos.map((memo) => ({ ...memo, y: at.get(memo.id)! })),
  };
}

const markerDefs = (color: string) =>
  `<defs>${[["one", CROW_ONE], ["many", CROW_MANY]]
    .map(([id, d]) => `<marker id="crow-${id}" viewBox="0 0 ${CROW_MARKER_SIZE} ${CROW_MARKER_SIZE}" refX="${CROW_MARKER_SIZE}" refY="${CROW_MARKER_SIZE / 2}" markerWidth="${CROW_MARKER_SIZE}" markerHeight="${CROW_MARKER_SIZE}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></marker>`)
    .join("")}</defs>`;

/**
 * The canvas's corner radii, which CSS derives from `--radius` (now 10px) as
 * shares of the old 14px base. The export draws in plain SVG, so it applies the
 * same ratio here; change both together.
 */
const corner = (px: number) => Math.round(px * (10 / 14) * 10) / 10;

/**
 * `edges` picks the line style: `curved` (the document card style, the default)
 * or `straight` -- out of the card sideways, one right-angle turn with the
 * canvas's rounded corner, routed past the other cards, exactly as the canvas
 * draws them.
 */
/**
 * `key` places the diagram's title, counts and legend: "top" (the image export)
 * puts the name, the counts and the legend in a band above the diagram;
 * "bottom" (the Document's ER figure) leaves the name to the document and draws
 * the counts and the legend large, under the diagram.
 */
export function renderDiagramSVG(schema: Schema, { theme = "light", edges: edgeStyle = "curved", key = "top", background }: { theme?: DiagramTheme; edges?: "curved" | "straight"; key?: "top" | "bottom"; background?: string } = {}) {
  // `background` lets the Document draw the figure on the page's own colour.
  const colors = background ? { ...THEMES[theme], background } : THEMES[theme];
  const dialect = dialectOf(schema);
  const canonical = schema.relationships?.length ? schema : normalizeRelationships(schema);
  const layout = reflowDiagram(canonical);
  const tablesById = new Map(canonical.tables.map((table) => [table.id, table]));
  const boxOf = (table: Table): Box => ({ ...layout.tables.get(table.id)!, width: tableWidth(table), height: tableHeight(table, "document") });

  const edges = (canonical.relationships ?? []).flatMap((relationship) => {
    const from = tablesById.get(relationship.startTableId);
    const to = tablesById.get(relationship.endTableId);
    const pair = relationship.fields[0] ?? { startFieldId: relationship.startFieldId, endFieldId: relationship.endFieldId };
    const fromIndex = from?.columns.findIndex((column) => column.id === pair.startFieldId) ?? -1;
    const toIndex = to?.columns.findIndex((column) => column.id === pair.endFieldId) ?? -1;
    if (!from || !to || fromIndex < 0 || toIndex < 0) return [];
    const end = (table: Table, index: number, other: Table) => {
      const box = boxOf(table);
      const otherBox = boxOf(other);
      const direction = facingSide(box.x, box.width, otherBox.x, otherBox.width);
      return { x: box.x + (direction === 1 ? box.width : 0), y: box.y + tableHeaderHeight(table, "document") + index * TABLE_FIELD_HEIGHT + TABLE_FIELD_HEIGHT / 2, direction, tableId: table.id };
    };
    return [{ id: relationship.id, relationship, name: `${from.name}.${from.columns[fromIndex].name} → ${to.name}.${to.columns[toIndex].name}`, from: end(from, fromIndex, to), to: end(to, toIndex, from) }];
  });
  // Keys sharing a port get a row each here too, so the picture matches the canvas.
  fanPorts(edges, ({ from, to }) => idealBend(from, to)).forEach(({ from, to }, index) => Object.assign(edges[index], { from, to }));

  const boxes: Box[] = [
    ...canonical.tables.map(boxOf),
    ...layout.groups.map((group) => ({ ...group, y: group.y - LANE_TITLE_HEIGHT, height: group.height + LANE_TITLE_HEIGHT })),
    ...layout.memos,
    // A curve bulges past its anchors by at most its reach.
    ...edges.flatMap((edge) => [edge.from, edge.to].map((end) => ({ x: end.x + Math.min(0, end.direction) * 60, y: end.y - 8, width: 60, height: 16 }))),
  ];
  const empty = !canonical.tables.length;
  const minX = boxes.length ? Math.min(...boxes.map((box) => box.x)) - PADDING : 0;
  const top = boxes.length ? Math.min(...boxes.map((box) => box.y)) - PADDING : 0;
  const minY = empty || key === "bottom" ? top : top - CHROME_HEIGHT;
  const width = boxes.length ? Math.max(...boxes.map((box) => box.x + box.width)) + PADDING - minX : PADDING * 2;
  const bottom = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) : 0;

  /*
   * The key for the Document's figure, under the diagram: what the counts are,
   * what the line ends and the badges mean, large enough to read once the
   * figure is shrunk onto a page. The name is the document's to say.
   */
  const relationships = edges.length;
  const summary = [
    `${canonical.tables.length} ${canonical.tables.length === 1 ? "table" : "tables"}`,
    `${relationships} ${relationships === 1 ? "relationship" : "relationships"}`,
    ...(layout.groups.length ? [`${layout.groups.length} ${layout.groups.length === 1 ? "group" : "groups"}`] : []),
  ].join(" · ");
  // Sized for the page it is shrunk onto: a wide diagram is drawn at about three quarters in a document.
  const KEY_FONT = 16;
  const KEY_CHAR = 9;
  /** A column's badge, as on the cards. */
  const badge = (x: number, y: number, label: string, [fill, ink]: readonly [string, string]) =>
    `<rect x="${round(x)}" y="${round(y - 8)}" width="24" height="16" rx="4" fill="${fill}"/><text x="${round(x + 12)}" y="${round(y)}" font-size="9.5" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${ink}" font-family='${MONO}'>${label}</text>`;
  /** The same badge, larger, for the key. */
  const keyBadge = (x: number, y: number, label: string, [fill, ink]: readonly [string, string]) =>
    `<rect x="${round(x)}" y="${round(y - 11)}" width="34" height="22" rx="5" fill="${fill}"/><text x="${round(x + 17)}" y="${round(y)}" font-size="12.5" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${ink}" font-family='${MONO}'>${label}</text>`;
  const text = (x: number, y: number, value: string, fill: string = colors.text, weight = 400) =>
    `<text x="${round(x)}" y="${round(y)}" font-size="${KEY_FONT}" font-weight="${weight}" dominant-baseline="central" fill="${fill}">${escapeXml(value)}</text>`;
  /** Each entry: its width, and how to draw it at a point. */
  const entries: { width: number; draw: (x: number, y: number) => string }[] = [
    { width: summary.length * KEY_CHAR, draw: (x, y) => text(x, y, summary, colors.muted, 600) },
    { width: 80 + "Foreign key (many → one)".length * KEY_CHAR, draw: (x, y) => `<path d="M ${round(x)} ${round(y)} H ${round(x + 64)}" stroke="${colors.edge}" stroke-width="1.8" marker-start="url(#crow-many)" marker-end="url(#crow-one)"/>${text(x + 80, y, "Foreign key (many → one)")}` },
    ...([["PK", "Primary key", colors.pk], ["FK", "Foreign key", colors.fk], ["UQ", "Unique", colors.uq]] as const).map(([label, name, palette]) => ({
      width: 44 + name.length * KEY_CHAR, draw: (x: number, y: number) => `${keyBadge(x, y, label, palette)}${text(x + 44, y, name)}`,
    })),
    { width: "? nullable".length * KEY_CHAR, draw: (x, y) => text(x, y, "? nullable", colors.muted) },
  ];
  const keyLeft = minX + PADDING;
  const keyRight = minX + width - PADDING;
  const GAP = 28;
  const rows: { x: number; entry: (typeof entries)[number] }[][] = [[]];
  let cursor = keyLeft;
  for (const entry of entries) {
    if (cursor > keyLeft && cursor + entry.width > keyRight) { rows.push([]); cursor = keyLeft; }
    rows[rows.length - 1].push({ x: cursor, entry });
    cursor += entry.width + GAP;
  }
  const keyTop = bottom + 12;
  const height = (empty ? PADDING * 2 : key === "bottom" ? keyTop + rows.length * LEGEND_ROW + PADDING - 8 : bottom + PADDING) - minY;

  /* The image export's band above the diagram: title and counts on the left, the legend on the right. */
  const chromeX = minX + PADDING;
  const chromeY = minY + PADDING;
  const legendX = Math.max(chromeX + 380, minX + width - PADDING - 420);
  const topChrome = [
    `<text x="${round(chromeX)}" y="${round(chromeY + 4)}" font-size="22" font-weight="700" letter-spacing="-0.4" fill="${colors.text}">${escapeXml(fit(canonical.name, legendX - chromeX - 24, 12))}</text>`,
    `<text x="${round(chromeX)}" y="${round(chromeY + 26)}" font-size="12" fill="${colors.muted}">${escapeXml(summary)}</text>`,
    `<g font-size="11.5" fill="${colors.text}">`,
    `<path d="M ${round(legendX)} ${round(chromeY - 4)} H ${round(legendX + 64)}" stroke="${colors.edge}" stroke-width="1.5" marker-start="url(#crow-many)" marker-end="url(#crow-one)"/>`,
    `<text x="${round(legendX + 76)}" y="${round(chromeY - 4)}" dominant-baseline="central">Foreign key (many → one)</text>`,
    badge(legendX + 250, chromeY - 4, "PK", colors.pk),
    `<text x="${round(legendX + 282)}" y="${round(chromeY - 4)}" dominant-baseline="central">Primary key</text>`,
    badge(legendX + 250, chromeY + 18, "FK", colors.fk),
    `<text x="${round(legendX + 282)}" y="${round(chromeY + 18)}" dominant-baseline="central">Foreign key</text>`,
    badge(legendX + 360, chromeY - 4, "UQ", colors.uq),
    `<text x="${round(legendX + 392)}" y="${round(chromeY - 4)}" dominant-baseline="central">Unique</text>`,
    `<text x="${round(legendX + 76)}" y="${round(chromeY + 18)}" dominant-baseline="central" fill="${colors.muted}">? nullable</text>`,
    `</g>`,
  ];
  const bottomChrome = [
    `<path d="M ${round(keyLeft)} ${round(keyTop - 4)} H ${round(keyRight)}" stroke="${colors.rule}" stroke-width="1"/>`,
    ...rows.flatMap((row, index) => row.map(({ x, entry }) => entry.draw(x, keyTop + 18 + index * LEGEND_ROW))),
  ];
  const chrome = empty ? [] : key === "bottom" ? bottomChrome : topChrome;

  const groups = layout.groups.map((group) => {
    const palette = GROUP_PALETTE[group.color];
    const fill = theme === "dark" ? `${palette.border}1f` : palette.background;
    const title = [group.keyword, group.name].filter(Boolean).join(" · ").toUpperCase();
    return [
      `<g>`,
      `<text x="${group.x + 2}" y="${group.y - 10}" font-size="12.5" font-weight="700" letter-spacing="0.6" fill="${theme === "dark" ? palette.border : palette.text}">${escapeXml(fit(title, group.width - 4, 8.4))}</text>`,
      `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${round(group.height)}" rx="${corner(12)}" fill="${fill}" stroke="${palette.border}" stroke-opacity="0.55"/>`,
      `</g>`,
    ].join("");
  });

  const memos = layout.memos.map((memo) => {
    const swatch = MEMO_SWATCHES[memo.color] ?? MEMO_SWATCHES.yellow;
    const room = Math.max(1, Math.floor((memo.height - 40) / MEMO_LINE));
    const all = wrapText(memo.text, (memo.width - 28) / CHAR_WIDTH);
    // Cut where the card ends, and say so on the last line that fits.
    const lines = all.length > room ? [...all.slice(0, room - 1), fit(`${all[room - 1]}…`, memo.width - 28)] : all;
    return [
      `<g>`,
      `<rect x="${memo.x}" y="${memo.y}" width="${memo.width}" height="${memo.height}" rx="${corner(10)}" fill="${theme === "dark" ? `${swatch.edge}26` : swatch.surface}" stroke="${swatch.edge}"/>`,
      `<text x="${memo.x + 14}" y="${memo.y + 34}" font-size="13" fill="${theme === "dark" ? colors.text : MEMO_INK}">`,
      ...lines.map((line, index) => `<tspan x="${memo.x + 14}" dy="${index ? MEMO_LINE : 0}">${escapeXml(line)}</tspan>`),
      `</text>`,
      `</g>`,
    ].join("");
  });

  // Straight lines turn where the canvas's router puts them: clear of every other card and of each other.
  const bends = edgeStyle === "straight"
    ? routeEdges(edges, canonical.tables.map((table) => ({ id: table.id, ...boxOf(table) })))
    : new Map<string, number>();
  const lines = edges.map((edge) => {
    const [fromCardinality, toCardinality] = relationshipCardinalities(edge.relationship);
    const d = edgeStyle === "straight" ? edgePath(edge.from, edge.to, bends.get(edge.id) ?? idealBend(edge.from, edge.to)) : curvePath(edge.from, edge.to);
    return `<path d="${d}" fill="none" stroke="${colors.edge}" stroke-width="1.3" marker-start="url(#crow-${crowMarker(fromCardinality)})" marker-end="url(#crow-${crowMarker(toCardinality)})"><title>${escapeXml(edge.name)}</title></path>`;
  });

  const cards = canonical.tables.map((table, index) => {
    const { x, y, width: cardWidth, height: cardHeight } = boxOf(table);
    const accent = table.color.a;
    const ink = inkOn(accent);
    const composite = uniqueGroupColumnIds(table);
    const clip = `card-${index}`;
    const comment = commentLines(table);
    const headerHeight = tableHeaderHeight(table, "document");
    const strategy = table.keyStrategy === "sequence-trigger" ? "SEQ+TRG" : table.keyStrategy === "identity" ? "IDENTITY" : "";
    const rows = table.columns.map((column, row) => {
      const top = y + headerHeight + row * TABLE_FIELD_HEIGHT;
      const middle = top + TABLE_FIELD_HEIGHT / 2;
      const kind = column.pk ? "pk" : column.fk ? "fk" : column.unique || composite.has(column.id) ? "uq" : null;
      const type = typeName(column, dialect).toLowerCase();
      const nameX = x + 40;
      const nameRoom = cardWidth - 40 - 12 - type.length * MONO_WIDTH - 8;
      return [
        row ? `<line x1="${x}" y1="${top}" x2="${x + cardWidth}" y2="${top}" stroke="${colors.rule}"/>` : "",
        kind ? badge(x + 10, middle, kind.toUpperCase(), colors[kind]) : "",
        `<text x="${nameX}" y="${middle}" font-size="11.5" font-family='${MONO}' dominant-baseline="central" fill="${colors.text}"${column.pk ? ` font-weight="700"` : ""}>${escapeXml(fit(column.name.toLowerCase(), nameRoom, MONO_WIDTH))}${column.notNull || column.pk ? "" : `<tspan fill="${colors.muted}" dominant-baseline="central">?</tspan>`}</text>`,
        `<text x="${x + cardWidth - 12}" y="${middle}" font-size="11" font-family='${MONO}' text-anchor="end" dominant-baseline="central" fill="${colors.muted}">${escapeXml(type)}</text>`,
      ].join("");
    });
    return [
      `<g>`,
      `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${corner(8)}"/></clipPath>`,
      `<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${corner(8)}" fill="${colors.card}"/>`,
      `<g clip-path="url(#${clip})">`,
      `<rect x="${x}" y="${y}" width="${cardWidth}" height="${DOCUMENT_HEADER_HEIGHT}" fill="${escapeXml(accent)}"/>`,
      comment.length
        ? `<rect x="${x}" y="${y + DOCUMENT_HEADER_HEIGHT}" width="${cardWidth}" height="${headerHeight - DOCUMENT_HEADER_HEIGHT}" fill="${escapeXml(accent)}" fill-opacity="${theme === "dark" ? 0.16 : 0.07}"/>` +
          `<line x1="${x}" y1="${y + headerHeight}" x2="${x + cardWidth}" y2="${y + headerHeight}" stroke="${escapeXml(accent)}" stroke-opacity="0.35"/>` +
          `<text x="${x + 12}" y="${y + DOCUMENT_HEADER_HEIGHT + COMMENT_PADDING + COMMENT_LINE_HEIGHT / 2}" font-size="11.5" fill="${colors.muted}">` +
          comment.map((line, at) => `<tspan x="${x + 12}" dy="${at ? COMMENT_LINE_HEIGHT : 0}" dominant-baseline="central">${escapeXml(line)}</tspan>`).join("") +
          `</text>`
        : "",
      ...rows,
      `</g>`,
      `<text x="${x + 12}" y="${y + DOCUMENT_HEADER_HEIGHT / 2}" font-size="13" font-weight="700" dominant-baseline="central" fill="${ink}">${escapeXml(fit(table.name.toLowerCase(), cardWidth - 24 - strategy.length * 6.4, 7.8))}</text>`,
      strategy ? `<text x="${x + cardWidth - 12}" y="${y + DOCUMENT_HEADER_HEIGHT / 2}" font-size="9.5" font-weight="600" letter-spacing="0.4" text-anchor="end" dominant-baseline="central" fill="${ink}" fill-opacity="0.75">${strategy}</text>` : "",
      `<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${corner(8)}" fill="none" stroke="${escapeXml(accent)}" stroke-width="1.5"/>`,
      `</g>`,
    ].join("");
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="${round(minX)} ${round(minY)} ${round(width)} ${round(height)}" font-family='${FONT}'>`,
    `<title>${escapeXml(schema.name)}</title>`,
    markerDefs(colors.edge),
    `<rect x="${round(minX)}" y="${round(minY)}" width="${round(width)}" height="${round(height)}" fill="${colors.background}"/>`,
    ...chrome,
    ...groups,
    ...memos,
    ...lines,
    ...cards,
    `</svg>`,
  ].join("\n");
}
