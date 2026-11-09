import * as Y from "yjs";
import {
  currentTableColor,
  normalizeLint,
  SCHEMA_FORMAT_VERSION,
  type Column,
  type ColumnTemplate,
  type Memo,
  type Relationship,
  type SavedQuery,
  type Schema,
  type SchemaGroup,
  type SchemaPackage,
  type Table,
} from "@/app/lib/schema";
import { spliceOf } from "@/app/lib/text-merge";

/**
 * The shared document mirrors `Schema` one-to-one: every domain collection is a
 * `Y.Array` of `Y.Map` records rather than an id-keyed map, because order is
 * user-visible (column order, table z-order) and `Y.Map` has no stable ordering.
 * Each record being its own `Y.Map` is what keeps edits granular — two people
 * renaming different tables touch disjoint keys and never conflict.
 *
 * `revision` and `updatedAt` are deliberately absent: they belong to the server's
 * mirror of the document, not to the document itself.
 */
export type YSchemaRoot = {
  meta: Y.Map<unknown>;
  tables: Y.Array<Y.Map<unknown>>;
  relationships: Y.Array<Y.Map<unknown>>;
  groups: Y.Array<Y.Map<unknown>>;
  memos: Y.Array<Y.Map<unknown>>;
  queries: Y.Array<Y.Map<unknown>>;
  columnTemplates: Y.Array<Y.Map<unknown>>;
  packages: Y.Array<Y.Map<unknown>>;
  /**
   * The written document (`Schema.documentation`) as text, so two people typing
   * in different paragraphs both keep their words. Documents from before it
   * hold the whole string in `meta.documentation`, read until the next write
   * moves it here.
   */
  documentation: Y.Text;
};

export const schemaRoot = (ydoc: Y.Doc): YSchemaRoot => ({
  meta: ydoc.getMap("meta"),
  tables: ydoc.getArray<Y.Map<unknown>>("tables"),
  relationships: ydoc.getArray<Y.Map<unknown>>("relationships"),
  groups: ydoc.getArray<Y.Map<unknown>>("groups"),
  memos: ydoc.getArray<Y.Map<unknown>>("memos"),
  queries: ydoc.getArray<Y.Map<unknown>>("queries"),
  columnTemplates: ydoc.getArray<Y.Map<unknown>>("columnTemplates"),
  packages: ydoc.getArray<Y.Map<unknown>>("packages"),
  documentation: ydoc.getText("documentation"),
});

/** A doc nobody has seeded yet. Guards against two clients both seeding on first open. */
export const isEmptyDoc = (ydoc: Y.Doc) => {
  const root = schemaRoot(ydoc);
  return root.meta.size === 0 && root.tables.length === 0 && root.groups.length === 0 && root.memos.length === 0 && root.relationships.length === 0 && root.queries.length === 0 && root.columnTemplates.length === 0 && root.packages.length === 0 && root.documentation.length === 0;
};

/**
 * Structural equality for the only shapes that reach a record field: primitives,
 * plain objects (`color`, `fk`) and arrays of those (`uniques`, `indexes`, `fields`).
 * It short-circuits on the first mismatch and on reference equality at every
 * level, where the `JSON.stringify` it replaces serialised both sides in full --
 * for every field of every record, on every commit.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
}

const same = (a: unknown, b: unknown) => deepEqual(a ?? null, b ?? null);

/** Writes only what actually differs — a no-op `set` still churns the network and the undo stack. */
function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown) {
  if (value === undefined) { if (map.has(key)) map.delete(key); return; }
  if (!same(map.get(key), value)) map.set(key, value);
}

/** Writes only the stretch that changed, so a concurrent edit elsewhere in the text survives the merge. */
function writeText(text: Y.Text, next: string) {
  const { at, remove, insert } = spliceOf(text.toString(), next);
  if (remove) text.delete(at, remove);
  if (insert) text.insert(at, insert);
}

const writeFields = (map: Y.Map<unknown>, fields: Record<string, unknown>) =>
  Object.entries(fields).forEach(([key, value]) => setIfChanged(map, key, value));

const readId = (map: Y.Map<unknown>) => map.get("id") as string;

/**
 * Reconciles a `Y.Array` of records against the next domain array: drop removed
 * ids, patch survivors in place, insert additions at their target index. A full
 * rebuild is the last resort for reordering, which `Y.Array` cannot express as a
 * move — but it only triggers when the order genuinely changed.
 */
function reconcileList<T extends { id: string }>(
  list: Y.Array<Y.Map<unknown>>,
  next: T[],
  write: (map: Y.Map<unknown>, item: T) => void,
) {
  const nextIds = new Set(next.map((item) => item.id));
  for (let index = list.length - 1; index >= 0; index -= 1) if (!nextIds.has(readId(list.get(index)))) list.delete(index, 1);

  /*
   * Survivors are patched before anything is inserted, so one index pass stays
   * valid for all of them -- the alternative, a `toArray().findIndex` per item,
   * rescanned the whole list for every record of every commit.
   */
  const indexById = new Map(list.toArray().map((map, index) => [readId(map), index]));
  next.forEach((item) => {
    const existing = indexById.get(item.id);
    if (existing !== undefined) write(list.get(existing), item);
  });
  // A preliminary Y.Map cannot be read back, so every record is integrated into
  // the list first and populated afterwards — never built up detached.
  next.forEach((item, target) => {
    if (indexById.has(item.id)) return;
    const map = new Y.Map<unknown>();
    list.insert(Math.min(target, list.length), [map]);
    write(map, item);
  });

  const order = list.toArray().map(readId);
  if (order.length === next.length && order.every((id, index) => id === next[index].id)) return;
  /*
   * Y.Array cannot express a move, so a record that changes place is deleted
   * and re-created -- but only across the span that actually moved. Rebuilding
   * the whole list would destroy every Y.Map in it, and those identities are
   * what the reader's cache and the undo stack are keyed on: one column
   * reordered would otherwise remake every record and repaint the whole canvas.
   *
   * A length mismatch means the doc holds duplicates of an id -- two clients
   * having seeded it, which `byId` hides on read -- so there is no span to
   * speak of and the whole list is rebuilt, which also dedupes it.
   */
  const rebuild = (from: number, to: number, remove = to - from + 1) => {
    list.delete(from, remove);
    const rebuilt = next.slice(from, to + 1).map(() => new Y.Map<unknown>());
    list.insert(from, rebuilt);
    rebuilt.forEach((map, index) => write(map, next[from + index]));
  };
  if (order.length !== next.length) return rebuild(0, next.length - 1, list.length);
  let from = 0;
  while (order[from] === next[from].id) from += 1;
  let to = next.length - 1;
  while (order[to] === next[to].id) to -= 1;
  rebuild(from, to);
}

const writeColumn = (map: Y.Map<unknown>, column: Column) =>
  writeFields(map, {
    id: column.id, name: column.name, type: column.type, size: column.size, notNull: column.notNull,
    pk: column.pk, unique: column.unique, defaultValue: column.defaultValue, check: column.check,
    comment: column.comment, fk: column.fk, postgresType: column.postgresType || undefined,
  });

function writeTable(map: Y.Map<unknown>, table: Table) {
  writeFields(map, {
    id: table.id, name: table.name, x: table.x, y: table.y, color: table.color,
    keyStrategy: table.keyStrategy, schemaId: table.schemaId, comment: table.comment, width: table.width,
    // Plain JSON like `relationship.fields`: a unique constraint is added,
    // emptied or deleted whole, so per-field granularity would buy nothing.
    uniques: table.uniques,
    indexes: table.indexes,
  });
  if (!(map.get("columns") instanceof Y.Array)) map.set("columns", new Y.Array<Y.Map<unknown>>());
  reconcileList(map.get("columns") as Y.Array<Y.Map<unknown>>, table.columns, writeColumn);
}

const writeRelationship = (map: Y.Map<unknown>, relationship: Relationship) =>
  writeFields(map, {
    id: relationship.id, startTableId: relationship.startTableId, startFieldId: relationship.startFieldId,
    endTableId: relationship.endTableId, endFieldId: relationship.endFieldId, fields: relationship.fields,
    name: relationship.name, cardinality: relationship.cardinality, manyLabel: relationship.manyLabel,
    updateConstraint: relationship.updateConstraint, deleteConstraint: relationship.deleteConstraint,
  });

const writeGroup = (map: Y.Map<unknown>, group: SchemaGroup) =>
  writeFields(map, { id: group.id, name: group.name, keyword: group.keyword, x: group.x, y: group.y, width: group.width, height: group.height, color: group.color });

const writeMemo = (map: Y.Map<unknown>, memo: Memo) =>
  writeFields(map, { id: memo.id, text: memo.text, x: memo.x, y: memo.y, width: memo.width, height: memo.height, color: memo.color, schemaId: memo.schemaId });

const writeQuery = (map: Y.Map<unknown>, query: SavedQuery) =>
  writeFields(map, { id: query.id, name: query.name, sql: query.sql, executions: query.executions });

// `columns` is one plain value: a template is edited whole, never column by column.
const writeColumnTemplate = (map: Y.Map<unknown>, template: ColumnTemplate) =>
  writeFields(map, { id: template.id, name: template.name, columns: template.columns });

// `tableIds` and `procedures` are plain values: a package's contents are edited whole, in its panel.
const writePackage = (map: Y.Map<unknown>, pkg: SchemaPackage) =>
  writeFields(map, { id: pkg.id, name: pkg.name, x: pkg.x, y: pkg.y, includeCrud: pkg.includeCrud, declarations: pkg.declarations, tableIds: pkg.tableIds, procedures: pkg.procedures });

/**
 * Applies a whole next `Schema` to the doc as one transaction. Taking a whole
 * schema — rather than granular operations — is what lets every existing
 * `commit(next)` call site in the designer stay exactly as it is.
 *
 * `origin` tags the transaction so `Y.UndoManager` can track only local edits.
 */
export function applySchemaToYDoc(ydoc: Y.Doc, next: Schema, origin?: unknown) {
  const root = schemaRoot(ydoc);
  ydoc.transact(() => {
    writeFields(root.meta, { id: next.id, name: next.name, schemaFormatVersion: next.schemaFormatVersion ?? SCHEMA_FORMAT_VERSION, documentation: undefined, dialect: next.dialect === "postgres" ? "postgres" : undefined, lintDisabled: next.lint?.disabled.length ? next.lint.disabled : undefined });
    reconcileList(root.tables, next.tables, writeTable);
    reconcileList(root.relationships, next.relationships ?? [], writeRelationship);
    reconcileList(root.groups, next.groups ?? [], writeGroup);
    reconcileList(root.memos, next.memos ?? [], writeMemo);
    reconcileList(root.queries, next.queries ?? [], writeQuery);
    reconcileList(root.columnTemplates, next.columnTemplates ?? [], writeColumnTemplate);
    reconcileList(root.packages, next.packages ?? [], writePackage);
    writeText(root.documentation, next.documentation ?? "");
  }, origin);
  return ydoc;
}

const readRecord = <T>(map: Y.Map<unknown>, keys: readonly (keyof T & string)[]) =>
  keys.reduce((record, key) => {
    const value = map.get(key);
    if (value !== undefined) (record as Record<string, unknown>)[key] = value;
    return record;
  }, {} as T);

const COLUMN_KEYS = ["id", "name", "type", "size", "notNull", "pk", "unique", "defaultValue", "check", "comment", "postgresType"] as const;
const TABLE_KEYS = ["id", "name", "x", "y", "color", "keyStrategy", "schemaId", "comment", "width", "uniques", "indexes"] as const;
const RELATIONSHIP_KEYS = ["id", "startTableId", "startFieldId", "endTableId", "endFieldId", "fields", "name", "cardinality", "manyLabel", "updateConstraint", "deleteConstraint"] as const;
const GROUP_KEYS = ["id", "name", "keyword", "x", "y", "width", "height", "color"] as const;
const MEMO_KEYS = ["id", "text", "x", "y", "width", "height", "color", "schemaId"] as const;
const QUERY_KEYS = ["id", "name", "sql", "executions"] as const;
const TEMPLATE_KEYS = ["id", "name", "columns"] as const;
const PACKAGE_KEYS = ["id", "name", "x", "y", "includeCrud", "declarations", "tableIds", "procedures"] as const;

/**
 * Ids are unique by definition in the domain, so a repeated id is always damage —
 * typically two clients having seeded the same document, whose records the CRDT
 * merges rather than dedupes. Reading keeps the first and drops the rest so a
 * damaged document still renders, rather than duplicating every table on screen.
 */
const byId = <T extends { id: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
};

/**
 * Reader-side identity cache, keyed on the shared type a record was read from
 * so an entry lives exactly as long as its record does.
 *
 * Without it `schemaFromYDoc` hands back a brand-new object graph on every
 * update, so every `Table` and `Column` gets a fresh reference and every
 * `memo()` in the designer misses — on every keystroke, for the twenty-four
 * tables you are *not* editing. Passing a cache is optional so the projection
 * stays a pure function of the doc.
 */
export type ReadCache = WeakMap<object, unknown>;
export const createReadCache = (): ReadCache => new WeakMap();

/** The previously read object when `built` is structurally identical to it. */
const stable = <T>(cache: ReadCache | undefined, key: object, built: T): T => {
  if (!cache) return built;
  const previous = cache.get(key) as T | undefined;
  if (previous !== undefined && deepEqual(previous, built)) return previous;
  cache.set(key, built);
  return built;
};

/**
 * The previous array when every element came back identical. Elements are
 * already stabilised by `stable`, so this is a reference scan, and it keeps the
 * memos keyed on `schema.tables` rather than on a table holding too.
 */
const stableList = <T>(cache: ReadCache | undefined, key: object, built: T[]): T[] => {
  if (!cache) return built;
  const previous = cache.get(key) as T[] | undefined;
  if (previous && previous.length === built.length && previous.every((item, index) => item === built[index])) return previous;
  cache.set(key, built);
  return built;
};

const readColumn = (map: Y.Map<unknown>, cache?: ReadCache): Column =>
  stable(cache, map, { ...readRecord<Column>(map, COLUMN_KEYS), fk: (map.get("fk") as Column["fk"]) ?? null });

const readTable = (map: Y.Map<unknown>, cache?: ReadCache): Table => {
  const columns = (map.get("columns") as Y.Array<Y.Map<unknown>> | undefined) ?? null;
  const record = readRecord<Table>(map, TABLE_KEYS);
  return stable(cache, map, {
    ...record,
    // A retired palette colour is projected to its replacement, so a room whose
    // document predates the palette change still draws the current one.
    color: currentTableColor(record.color),
    columns: byId((columns?.toArray() ?? []).map((column) => readColumn(column, cache))),
  });
};

/**
 * Moves a document from before `YSchemaRoot.documentation` (the whole string
 * in `meta`) into its text. The collab server calls it once, as a room loads:
 * done by each client instead, two of them could insert the same text twice.
 */
export function migrateLegacyDocumentation(ydoc: Y.Doc) {
  const root = schemaRoot(ydoc);
  const legacy = root.meta.get("documentation");
  if (!root.meta.has("documentation")) return;
  ydoc.transact(() => {
    if (!root.documentation.length && typeof legacy === "string") root.documentation.insert(0, legacy);
    root.meta.delete("documentation");
  });
}

const readDocumentation = (root: YSchemaRoot) => {
  const legacy = root.meta.get("documentation");
  const text = root.documentation.length ? root.documentation.toString() : typeof legacy === "string" ? legacy : "";
  return text ? { documentation: text } : {};
};

/**
 * Projects the shared document back into the plain `Schema` the whole domain
 * layer already speaks, so validation, generation and export stay untouched.
 * `id` and `revision` are server-owned and may be supplied by the caller.
 */
export function schemaFromYDoc(
  ydoc: Y.Doc,
  overrides: { id?: string; revision?: number } = {},
  cache?: ReadCache,
): Schema {
  const root = schemaRoot(ydoc);
  const read = <T extends { id: string }>(list: Y.Array<Y.Map<unknown>>, keys: readonly (keyof T & string)[]) =>
    stableList(cache, list, byId(list.toArray().map((map) => stable(cache, map, readRecord<T>(map, keys)))));
  return {
    id: overrides.id ?? (root.meta.get("id") as string) ?? "",
    name: (root.meta.get("name") as string) ?? "Untitled",
    revision: overrides.revision ?? 0,
    schemaFormatVersion: (root.meta.get("schemaFormatVersion") as number) ?? SCHEMA_FORMAT_VERSION,
    tables: stableList(cache, root.tables, byId(root.tables.toArray().map((map) => readTable(map, cache)))),
    relationships: read<Relationship>(root.relationships, RELATIONSHIP_KEYS),
    groups: read<SchemaGroup>(root.groups, GROUP_KEYS),
    memos: read<Memo>(root.memos, MEMO_KEYS),
    queries: read<SavedQuery>(root.queries, QUERY_KEYS),
    columnTemplates: read<ColumnTemplate>(root.columnTemplates, TEMPLATE_KEYS),
    packages: read<SchemaPackage>(root.packages, PACKAGE_KEYS),
    ...readDocumentation(root),
    ...(root.meta.get("dialect") === "postgres" ? { dialect: "postgres" as const } : {}),
    ...normalizeLint({ disabled: root.meta.get("lintDisabled") }),
  };
}
