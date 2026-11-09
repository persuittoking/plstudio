import {
  cloneSchema,
  normalizeMemos,
  normalizeColumnTemplates,
  normalizePackages,
  normalizeQueries,
  normalizeGroups,
  normalizeRelationships,
  normalizeTables,
  tableHeight,
  tableWidth,
  type Relationship,
  type CardStyle,
  type Schema,
  type Table,
} from "@/app/lib/schema";
import {
  GROUP_HEADER_HEIGHT,
  GROUP_MIN_HEIGHT,
  GROUP_MIN_WIDTH,
  RESIZE_STEP,
  RESIZE_STEP_COARSE,
  WHEEL_LINE_HEIGHT,
  WHEEL_PAGE_HEIGHT,
} from "./constants";
import { layeredPlaces, type LayoutLink } from "./graph-layout";

/** Pixels per unit of a wheel event's delta, whichever unit the device reports. */
export const wheelScale = (event: WheelEvent) =>
  event.deltaMode === 1
    ? WHEEL_LINE_HEIGHT
    : event.deltaMode === 2
      ? WHEEL_PAGE_HEIGHT
      : 1;

/** Arrow-key deltas for the resize handles, which are otherwise pointer-only. */
export const resizeDelta = (event: React.KeyboardEvent) => {
  const step = event.shiftKey ? RESIZE_STEP_COARSE : RESIZE_STEP;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  return deltas[event.key] ?? null;
};

/**
 * Whether a dropped card's centre lands inside a group. The header strip is
 * excluded: that band is how the group itself is grabbed, so a card resting
 * over it belongs to the canvas, not to the group.
 */
export const enclosedBy = (
  rect: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
) =>
  x >= rect.x &&
  x <= rect.x + rect.width &&
  y >= rect.y + GROUP_HEADER_HEIGHT &&
  y <= rect.y + rect.height;

/**
 * `MLL` out of `MLL -- MULTI LANGUAGE TOOLS`. Only a short leading token that
 * is actually set off by a separator counts, so `Schema 1` suggests nothing
 * rather than suggesting `SCHEMA`. A placeholder only — never written.
 */
export const keywordHint = (name: string) =>
  name
    .trim()
    .match(/^([A-Za-z0-9]{1,8})\s*(?:--|[-–—:_])/)?.[1]
    .toUpperCase() ?? "KEY";

/**
 * Where the `index`-th card of a group lands: stacked down from the corner
 * below the header, kept clear of the borders, and centred instead when the
 * card is too wide or tall to sit inside with margins. Centring is the part
 * that matters — `enclosedBy` tests the card's *centre*, so a card placed
 * anywhere else would be evicted from the group by the next resize.
 *
 * `at` asks for a specific point instead of the stack -- the place a context
 * menu was opened at -- and goes through the same clamp, so a card dropped near
 * an edge still lands inside the group rather than half out of it.
 */
export const insideGroup = (
  rect: { x: number; y: number; width: number; height: number },
  table: Table,
  index: number,
  at?: { x: number; y: number },
  style: CardStyle = "classic",
) => {
  const place = (start: number, span: number, size: number, offset: number) => {
    const low = start + 12;
    const high = start + span - size - 12;
    return Math.round(
      high < low
        ? start + (span - size) / 2
        : Math.max(low, Math.min(high, low + offset)),
    );
  };
  return {
    x: place(rect.x, rect.width, tableWidth(table), at ? at.x - rect.x - 12 : 12 + (index % 3) * 40),
    y: place(
      rect.y + GROUP_HEADER_HEIGHT,
      rect.height - GROUP_HEADER_HEIGHT,
      tableHeight(table, style),
      at ? at.y - rect.y - GROUP_HEADER_HEIGHT - 12 : 6 + (index % 4) * 40,
    ),
  };
};

export function repairInitialLayout(schema: Schema): Schema {
  const next = cloneSchema(schema);
  const gap = 24;
  const overlaps = (table: Table, x: number, y: number) =>
    next.tables.some((other) => {
      if (other.id === table.id) return false;
      const width = tableWidth(table);
      const otherWidth = tableWidth(other);
      return (
        x < other.x + otherWidth + gap &&
        x + width + gap > other.x &&
        y < other.y + tableHeight(other) + gap &&
        y + tableHeight(table) + gap > other.y
      );
    });
  next.tables.forEach((table, index) => {
    if (index === 0 || !overlaps(table, table.x, table.y)) return;
    const startX = table.x;
    const startY = table.y;
    for (let ring = 1; ring <= 24; ring += 1) {
      const step = 48 * ring;
      const candidates = [
        { x: startX + step, y: startY },
        { x: startX - step, y: startY },
        { x: startX, y: startY + step },
        { x: startX, y: startY - step },
        { x: startX + step, y: startY + step },
        { x: startX - step, y: startY + step },
        { x: startX + step, y: startY - step },
        { x: startX - step, y: startY - step },
      ];
      // Every ring is legal, negatives included: there is no edge to fall off.
      const free = candidates.find(
        (candidate) => !overlaps(table, candidate.x, candidate.y),
      );
      if (free) {
        table.x = free.x;
        table.y = free.y;
        break;
      }
    }
  });
  return next;
}

/** Gap between tidied cards, and between the tidied groups themselves. */
const TIDY_GAP = 24;
const TIDY_GROUP_GAP = 48;
/** Inset from a group's edges. The same 12 `insideGroup` uses, for the same reason. */
const TIDY_MARGIN = 12;
const TIDY_ORIGIN = 70;
const TIDY_MAX_COLUMNS = 4;
/** How wide a row of groups may get before it wraps. */
const TIDY_ROW_WIDTH = 1440;

type PackBox = { width: number; height: number };

/**
 * Lays boxes left-to-right, wrapping once the next one would cross `maxWidth`.
 * A box wider than the limit is still placed rather than dropped -- it takes a
 * row of its own and the reported extent grows to hold it, so a caller sizing a
 * container around the result never clips its own content.
 */
function packBoxes(boxes: PackBox[], maxWidth: number, gap: number) {
  const places: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  let height = 0;
  boxes.forEach((box) => {
    if (x > 0 && x + box.width > maxWidth) {
      x = 0;
      y += row + gap;
      row = 0;
    }
    places.push({ x, y });
    x += box.width + gap;
    row = Math.max(row, box.height);
    width = Math.max(width, x - gap);
    height = Math.max(height, y + row);
  });
  return { places, width, height };
}

/**
 * Columns for a bucket of `count` cards. Derived from the count alone and never
 * from the current layout, which is what makes a second tidy a no-op.
 */
const tidyColumns = (count: number) =>
  Math.min(TIDY_MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(count))));

/**
 * Rearranges every card without ever changing which group it belongs to.
 *
 * Inside a bucket -- a group's members, or the loose tables taken together --
 * the arrangement comes from the foreign keys between them: `layeredPlaces`
 * puts a child one column left of its parent and orders each column to pull
 * the edges between two columns straight. A bucket whose members reference
 * nothing falls through to the shelf packer, so a diagram with no
 * relationships tidies exactly as it always did.
 *
 * Membership is re-derived geometrically the next time a group is resized --
 * `commitGroupSize` tests each member's *centre* with `enclosedBy` -- so a
 * layout that moved a table outside its group's box would not merely look
 * wrong, it would silently evict the table on that next resize. Hence: members
 * are packed *inside* their group and the group grows to hold them, and the
 * loose tables are flowed *below* every group rather than beside one, so a
 * table that belongs to nothing can never come to rest inside a group's box and
 * be adopted by it. `schemaId` is read here and never written.
 */
export function tidyLayout(schema: Schema, style: CardStyle = "classic"): Schema {
  const next = cloneSchema(schema);
  const boxOf = (table: Table) => ({ width: tableWidth(table), height: tableHeight(table, style) });
  const links: LayoutLink[] = (next.relationships ?? []).map((relationship) => ({
    from: relationship.startTableId,
    to: relationship.endTableId,
  }));
  /** Which bucket a table is in, so an inter-group edge can be told apart. */
  const bucketOf = new Map(next.tables.map((table) => [table.id, table.schemaId ?? ""]));
  const within = (members: Table[]) => {
    const inside = new Set(members.map((table) => table.id));
    return links.filter((link) => inside.has(link.from) && inside.has(link.to));
  };
  /**
   * The graph decides the arrangement wherever there is one to read. A bucket
   * with no edges of its own has nothing to layer, and the shelf packer's grid
   * is the better answer there -- it is also the answer this has always given.
   */
  const arrange = (members: Table[], shelfWidth: (boxes: PackBox[]) => number) => {
    const boxes = members.map(boxOf);
    const edges = within(members);
    return edges.length
      ? layeredPlaces(
          members.map((table, index) => ({ id: table.id, ...boxes[index] })),
          edges,
          TIDY_GAP,
        )
      : packBoxes(boxes, shelfWidth(boxes), TIDY_GAP);
  };
  /** The two shelf shapes tidy has always used, kept for the bucket that has
   *  no edges to lay out. */
  const groupShelf = (boxes: PackBox[]) => {
    const widest = Math.max(GROUP_MIN_WIDTH - TIDY_MARGIN * 2, ...boxes.map((box) => box.width));
    const columns = tidyColumns(boxes.length);
    return columns * widest + (columns - 1) * TIDY_GAP;
  };
  const looseShelf = (boxes: PackBox[]) => {
    const widest = Math.max(1, ...boxes.map((box) => box.width));
    return TIDY_MAX_COLUMNS * widest + (TIDY_MAX_COLUMNS - 1) * TIDY_GAP;
  };
  // Sized against their own members first; where they land is decided after.
  const filled = (next.groups ?? []).map((group) => {
    const members = next.tables.filter((table) => table.schemaId === group.id);
    const packed = arrange(members, groupShelf);
    return {
      group,
      members,
      places: packed.places,
      width: Math.max(GROUP_MIN_WIDTH, packed.width + TIDY_MARGIN * 2),
      height: Math.max(GROUP_MIN_HEIGHT, GROUP_HEADER_HEIGHT + packed.height + TIDY_MARGIN * 2),
    };
  });
  /**
   * Groups flow in the order the edges between them suggest: start from the
   * most connected, then keep appending whichever unplaced group is most
   * connected to the one just placed. It only shortens the long trunks that
   * cross the whole canvas, and with no inter-group edges every weight is zero
   * and the order falls back to the array's own -- what it has always been.
   */
  const weight = (a: string, b: string) =>
    links.filter(
      (link) =>
        (bucketOf.get(link.from) === a && bucketOf.get(link.to) === b) ||
        (bucketOf.get(link.from) === b && bucketOf.get(link.to) === a),
    ).length;
  const total = (id: string) =>
    filled.reduce((sum, other) => sum + (other.group.id === id ? 0 : weight(id, other.group.id)), 0);
  const order: number[] = [];
  const pending = filled.map((_, index) => index);
  while (pending.length) {
    const last = order.length ? filled[order[order.length - 1]].group.id : null;
    const pick = pending.reduce((best, index) =>
      // Original index last, so a tie can only ever resolve one way.
      (last ? weight(last, filled[index].group.id) : total(filled[index].group.id)) >
      (last ? weight(last, filled[best].group.id) : total(filled[best].group.id))
        ? index
        : best,
    );
    order.push(pick);
    pending.splice(pending.indexOf(pick), 1);
  }
  const flow = packBoxes(order.map((index) => filled[index]), TIDY_ROW_WIDTH, TIDY_GROUP_GAP);
  let bottom = TIDY_ORIGIN;
  order.forEach((entryIndex, index) => {
    const entry = filled[entryIndex];
    const x = TIDY_ORIGIN + flow.places[index].x;
    const y = TIDY_ORIGIN + flow.places[index].y;
    const dx = x - entry.group.x;
    const dy = y - entry.group.y;
    Object.assign(entry.group, { x, y, width: entry.width, height: entry.height });
    entry.members.forEach((table, member) => {
      table.x = x + TIDY_MARGIN + entry.places[member].x;
      table.y = y + GROUP_HEADER_HEIGHT + TIDY_MARGIN + entry.places[member].y;
    });
    // Memos keep whatever arrangement they were given; they only ride along.
    next.memos?.forEach((memo) => {
      if (memo.schemaId !== entry.group.id) return;
      memo.x += dx;
      memo.y += dy;
    });
    bottom = Math.max(bottom, y + entry.height);
  });
  const loose = next.tables.filter(
    (table) => !filled.some((entry) => entry.group.id === table.schemaId),
  );
  const top = filled.length ? bottom + TIDY_GROUP_GAP : TIDY_ORIGIN;
  arrange(loose, looseShelf).places.forEach((place, index) => {
    loose[index].x = TIDY_ORIGIN + place.x;
    loose[index].y = top + place.y;
  });
  return next;
}

export function prepareCanvasSchema(schema: Schema): Schema {
  const next = repairInitialLayout(
    normalizeTables(normalizeGroups(normalizeRelationships(schema))),
  );
  next.memos = normalizeMemos(next.memos);
  next.queries = normalizeQueries(next.queries);
  next.columnTemplates = normalizeColumnTemplates(next.columnTemplates);
  next.packages = normalizePackages(next.packages, next.tables.map((table) => table.id));
  return next;
}

/**
 * The pair of markers drawn at each end of an edge, and the pair the side panel
 * joins with a colon. Shared so the two can never disagree.
 */
export const relationshipCardinalities = (relationship: Relationship) => {
  if (relationship.cardinality === "one_to_one") return ["1", "1"];
  if (relationship.cardinality === "one_to_many")
    return ["1", relationship.manyLabel || "n"];
  return [relationship.manyLabel || "n", "1"];
};
