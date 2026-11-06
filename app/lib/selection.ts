import { groupMembers, nextId, normalizeGroups, normalizeIdentifier, normalizeRelationships, tableHeight, tableWidth, type CardStyle, type Memo, type Relationship, type Schema, type SchemaGroup, type Table } from "./schema";

/**
 * What the canvas has selected, and everything that follows from it: marquee
 * hit-testing, the bounds a multi-drag is clamped to, and the narrowed `Schema`
 * that copy-as-SQL and copy-as-JSON hand to the generators.
 *
 * Pure by design, like the rest of the domain layer -- no React, no DOM. The
 * designer owns the state; this file owns the rules.
 */

export type SelectionKind = "table" | "memo" | "group";

export type CanvasSelection = { tables: string[]; memos: string[]; groups: string[] };

export type Rect = { x: number; y: number; width: number; height: number };

export const EMPTY_SELECTION: CanvasSelection = { tables: [], memos: [], groups: [] };

export const selectionCount = (selection: CanvasSelection) => selection.tables.length + selection.memos.length + selection.groups.length;

export const isSelected = (selection: CanvasSelection, kind: SelectionKind, id: string) =>
  (kind === "table" ? selection.tables : kind === "memo" ? selection.memos : selection.groups).includes(id);

export const selectOnly = (kind: SelectionKind, id: string): CanvasSelection => ({
  tables: kind === "table" ? [id] : [],
  memos: kind === "memo" ? [id] : [],
  groups: kind === "group" ? [id] : [],
});

export function toggleSelected(selection: CanvasSelection, kind: SelectionKind, id: string): CanvasSelection {
  const toggle = (ids: string[]) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  return {
    tables: kind === "table" ? toggle(selection.tables) : selection.tables,
    memos: kind === "memo" ? toggle(selection.memos) : selection.memos,
    groups: kind === "group" ? toggle(selection.groups) : selection.groups,
  };
}

/**
 * A group and everything inside it. The group itself is included so the result
 * reads as "this schema", and so a drag of the selection carries the rectangle
 * along with its contents rather than sliding the cards out from under it.
 */
export const selectGroupWithMembers = (schema: Schema, groupId: string): CanvasSelection => {
  const members = groupMembers(schema, groupId);
  return {
    tables: members.tables.map((table) => table.id),
    memos: members.memos.map((memo) => memo.id),
    groups: [groupId],
  };
};

export const selectAll = (schema: Schema): CanvasSelection => ({
  tables: schema.tables.map((table) => table.id),
  memos: (schema.memos ?? []).map((memo) => memo.id),
  groups: (schema.groups ?? []).map((group) => group.id),
});

/**
 * Drop ids that are no longer on the canvas. A collaborator can delete a table
 * this client has selected, and a selection holding a dead id would move, copy
 * or delete nothing while still counting towards the toolbar's total.
 * Returns the same object when nothing changed, so it is safe in a render path.
 */
export function pruneSelection(schema: Schema, selection: CanvasSelection): CanvasSelection {
  const tables = selection.tables.filter((id) => schema.tables.some((table) => table.id === id));
  const memos = selection.memos.filter((id) => (schema.memos ?? []).some((memo) => memo.id === id));
  const groups = selection.groups.filter((id) => (schema.groups ?? []).some((group) => group.id === id));
  return tables.length === selection.tables.length && memos.length === selection.memos.length && groups.length === selection.groups.length
    ? selection
    : { tables, memos, groups };
}

/** A card's box in the style the canvas draws it -- a document card runs taller by its comment. */
const tableBox = (table: Table, style: CardStyle = "classic"): Rect => ({ x: table.x, y: table.y, width: tableWidth(table), height: tableHeight(table, style) });
const memoBox = (memo: Memo): Rect => ({ x: memo.x, y: memo.y, width: memo.width, height: memo.height });
const groupBox = (group: SchemaGroup): Rect => ({ x: group.x, y: group.y, width: group.width, height: group.height });

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

const union = (a: string[], b: string[]) => (b.length ? [...new Set([...a, ...b])] : a);

/** The rectangle a drag from one point to another sweeps, however it was drawn. */
export const rectFromPoints = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  width: Math.abs(x1 - x0),
  height: Math.abs(y1 - y0),
});

/**
 * Everything the marquee has swept, unioned onto `base` so an additive drag
 * extends the selection instead of replacing it.
 *
 * Tables and memos are taken on any overlap, the way Finder and the Windows
 * desktop take an icon the rubber band merely touches. A group needs to be
 * *enclosed whole*: crossing its interior is how you pick out the cards inside
 * without carrying off the schema they sit in.
 */
export function marqueeSelection(schema: Schema, rect: Rect, base: CanvasSelection = EMPTY_SELECTION, style: CardStyle = "classic"): CanvasSelection {
  return {
    tables: union(base.tables, schema.tables.filter((table) => overlaps(rect, tableBox(table, style))).map((table) => table.id)),
    memos: union(base.memos, (schema.memos ?? []).filter((memo) => overlaps(rect, memoBox(memo))).map((memo) => memo.id)),
    groups: union(base.groups, (schema.groups ?? []).filter((group) => contains(rect, groupBox(group))).map((group) => group.id)),
  };
}

/**
 * Every entity that travels when the selection is dragged. A selected group
 * brings its members, so these are sets rather than lists: a table that is both
 * selected outright and a member of a selected group appears once, and the
 * delta is therefore applied to it once.
 */
export function movingEntities(schema: Schema, selection: CanvasSelection) {
  const groups = new Set(selection.groups.filter((id) => (schema.groups ?? []).some((group) => group.id === id)));
  const tables = new Set(selection.tables);
  const memos = new Set(selection.memos);
  groups.forEach((id) => {
    const members = groupMembers(schema, id);
    members.tables.forEach((table) => tables.add(table.id));
    members.memos.forEach((memo) => memos.add(memo.id));
  });
  return { tables, memos, groups };
}

const selectionBoxes = (schema: Schema, selection: CanvasSelection, style: CardStyle): Rect[] => {
  const moving = movingEntities(schema, selection);
  return [
    ...schema.tables.filter((table) => moving.tables.has(table.id)).map((table) => tableBox(table, style)),
    ...(schema.memos ?? []).filter((memo) => moving.memos.has(memo.id)).map(memoBox),
    ...(schema.groups ?? []).filter((group) => moving.groups.has(group.id)).map(groupBox),
  ];
};

/** The box drawn around the whole selection, or `null` when nothing is selected. */
export function selectionBounds(schema: Schema, selection: CanvasSelection, style: CardStyle = "classic"): Rect | null {
  const boxes = selectionBoxes(schema, selection, style);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/**
 * Shift the selection by a delta.
 *
 * Deliberately no overlap push-out and no group-membership reassignment, for
 * the reason `commitGroupPosition` gives for a group move: rearranging the
 * layout the user built is the one thing relocating it must not do. A card
 * keeps the schema it belonged to, wherever the set comes to rest.
 */
export function moveSelection(schema: Schema, selection: CanvasSelection, dx: number, dy: number): Schema {
  const moving = movingEntities(schema, selection);
  const shift = <T extends { id: string; x: number; y: number }>(item: T, ids: Set<string>) =>
    ids.has(item.id) ? { ...item, x: Math.round(item.x + dx), y: Math.round(item.y + dy) } : item;
  return {
    ...schema,
    tables: schema.tables.map((table) => shift(table, moving.tables)),
    memos: schema.memos?.map((memo) => shift(memo, moving.memos)),
    groups: schema.groups?.map((group) => shift(group, moving.groups)),
  };
}

/**
 * Delete everything selected, in one commit so the whole set is one undo step.
 *
 * A selected group takes only its own rectangle: deleting a schema is not a way
 * of deleting the tables drawn inside it, which is how `deleteGroup` has always
 * behaved. Members left behind are released to the canvas. `normalizeRelationships`
 * then sheds every edge whose other end has just gone.
 */
export function removeSelection(schema: Schema, selection: CanvasSelection): Schema {
  const tables = new Set(selection.tables);
  const memos = new Set(selection.memos);
  const groups = new Set(selection.groups);
  if (!tables.size && !memos.size && !groups.size) return schema;
  const orphaned = (schemaId: string | undefined) => (groups.has(schemaId ?? "") ? undefined : schemaId);
  return normalizeRelationships({
    ...schema,
    tables: schema.tables
      .filter((table) => !tables.has(table.id))
      .map((table) => ({
        ...table,
        schemaId: orphaned(table.schemaId),
        columns: table.columns.map((column) => (column.fk && tables.has(column.fk.tableId) ? { ...column, fk: null } : column)),
      })),
    memos: schema.memos?.filter((memo) => !memos.has(memo.id)).map((memo) => ({ ...memo, schemaId: orphaned(memo.schemaId) })),
    groups: schema.groups?.filter((group) => !groups.has(group.id)),
  });
}

/** How far a duplicate lands from its original: clear of it, but plainly its twin. */
export const DUPLICATE_OFFSET = 32;

/**
 * Copy tables in place, as one commit. Every id is re-minted -- table, column,
 * constraint, index and relationship -- since ids are what the CRDT and the
 * canvas key on.
 *
 * Outgoing foreign keys come along: a key into a table that was copied too
 * points at that copy (so a self-reference stays a self-reference), any other
 * still points where it did. Incoming keys stay with the original, which is the
 * table they were drawn to. Constraint, index and relationship names are cleared
 * rather than copied, because Oracle names are schema-wide and the generator
 * mints fresh ones from the new table name.
 */
export function duplicateTables(schema: Schema, tableIds: string[]): { schema: Schema; added: Table[] } {
  const originals = schema.tables.filter((table) => tableIds.includes(table.id));
  if (!originals.length) return { schema, added: [] };
  const taken = new Set(schema.tables.map((table) => normalizeIdentifier(table.name)));
  /** `ORDERS_COPY`, then `ORDERS_COPY2`, … -- whichever Oracle would not see as a clash. */
  const copyName = (name: string) => {
    let next = `${name}_COPY`;
    for (let n = 2; taken.has(normalizeIdentifier(next)); n++) next = `${name}_COPY${n}`;
    taken.add(normalizeIdentifier(next));
    return next;
  };
  const tableMap = new Map(originals.map((table) => [table.id, nextId("tbl")] as const));
  const columnMap = new Map(originals.flatMap((table) => table.columns.map((column) => [column.id, nextId("col")] as const)));
  // Column ids are unique schema-wide, so the map alone says whether a column was copied.
  const column = (id: string) => columnMap.get(id) ?? id;
  const remapSets = <T extends { id: string; name?: string; columnIds: string[] }>(sets: T[] | undefined, prefix: string) =>
    sets?.map((set) => ({ ...set, id: nextId(prefix), name: undefined, columnIds: set.columnIds.map(column) }));
  const added = originals.map((table): Table => ({
    ...table,
    id: tableMap.get(table.id)!,
    name: copyName(table.name),
    x: table.x + DUPLICATE_OFFSET,
    y: table.y + DUPLICATE_OFFSET,
    columns: table.columns.map((item) => ({
      ...item,
      id: column(item.id),
      fk: item.fk && { tableId: tableMap.get(item.fk.tableId) ?? item.fk.tableId, columnId: column(item.fk.columnId) },
    })),
    uniques: remapSets(table.uniques, "uk"),
    indexes: remapSets(table.indexes, "idx"),
  }));
  const relationships = (schema.relationships ?? [])
    .filter((relationship) => tableMap.has(relationship.startTableId))
    .map((relationship): Relationship => ({
      ...relationship,
      id: nextId("rel"),
      name: "",
      startTableId: tableMap.get(relationship.startTableId)!,
      startFieldId: column(relationship.startFieldId),
      endTableId: tableMap.get(relationship.endTableId) ?? relationship.endTableId,
      endFieldId: column(relationship.endFieldId),
      fields: relationship.fields.map((pair) => ({ startFieldId: column(pair.startFieldId), endFieldId: column(pair.endFieldId) })),
    }));
  const next = normalizeRelationships({ ...schema, tables: [...schema.tables, ...added], relationships: [...(schema.relationships ?? []), ...relationships] });
  const ids = new Set(added.map((table) => table.id));
  return { schema: next, added: next.tables.filter((table) => ids.has(table.id)) };
}

/**
 * The selection as a `Schema` that stands on its own -- what `generateDDL` and
 * `exportSchemaJson` are handed.
 *
 * Selected groups bring their members, so copying a schema rectangle copies
 * what is drawn in it. The normalizers then drop every relationship with an end
 * outside the subset (and null the foreign key that named it) and clear any
 * `schemaId` pointing at a group that did not come along, because the copy has
 * to make sense wherever it is pasted.
 */
export function selectionSchema(schema: Schema, selection: CanvasSelection): Schema {
  const moving = movingEntities(schema, selection);
  return normalizeGroups(
    normalizeRelationships({
      ...schema,
      tables: schema.tables.filter((table) => moving.tables.has(table.id)),
      memos: (schema.memos ?? []).filter((memo) => moving.memos.has(memo.id)),
      groups: (schema.groups ?? []).filter((group) => moving.groups.has(group.id)),
      // Queries, templates and the written document belong to the diagram, not to anything drawn: a paste must not repeat them.
      queries: [],
      columnTemplates: [],
      documentation: undefined,
    }),
  );
}

/**
 * One table and everything one foreign key away from it -- what stays lit when
 * the canvas dims the rest.
 *
 * One hop, not the transitive closure: on the diagrams that need this at all,
 * two hops is most of the schema and dims nothing. A table with no root, or a
 * root that no relationship names, yields empty sets and the canvas dims
 * nothing rather than dimming everything.
 */
export function neighbourhood(relationships: Relationship[], rootId: string | null) {
  const tables = new Set<string>();
  const edges = new Set<string>();
  if (!rootId) return { tables, edges };
  tables.add(rootId);
  relationships.forEach((relationship) => {
    if (relationship.startTableId !== rootId && relationship.endTableId !== rootId) return;
    edges.add(relationship.id);
    tables.add(relationship.startTableId);
    tables.add(relationship.endTableId);
  });
  return { tables, edges };
}

/** What the canvas is focused on: a card, or one of the lines between them. */
export type FocusTarget = { kind: "table" | "edge"; id: string };

/**
 * What stays lit, for either kind of focus.
 *
 * Pointing at a table asks "what does this touch"; pointing at one line asks
 * the narrower question "what does *this* join", and answers it with the two
 * tables at its ends and nothing else. A target naming something that no longer
 * exists lights nothing, and the canvas dims nothing rather than everything.
 */
export function focusedEntities(relationships: Relationship[], target: FocusTarget | null) {
  if (!target) return { tables: new Set<string>(), edges: new Set<string>() };
  if (target.kind === "table") return neighbourhood(relationships, target.id);
  const edge = relationships.find((relationship) => relationship.id === target.id);
  return edge
    ? { tables: new Set([edge.startTableId, edge.endTableId]), edges: new Set([edge.id]) }
    : { tables: new Set<string>(), edges: new Set<string>() };
}
