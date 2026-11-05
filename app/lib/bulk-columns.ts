import { typeUsesSize, type Column, type OracleType, type Schema } from "./schema";

/**
 * Editing many columns at once, across tables: find them, then set shared
 * properties or rename them by find-and-replace. Each operation returns a whole
 * next `Schema`, so the caller commits once and one undo reverts the lot.
 *
 * Pure by design, like the rest of the domain layer.
 */

export type ColumnRef = { tableId: string; columnId: string };

export type ColumnFilter = {
  /** Matched case-insensitively against `COLUMN` and `TABLE.COLUMN`. */
  text?: string;
  type?: OracleType;
  tableId?: string;
};

export type BulkColumnPatch = Partial<Pick<Column, "type" | "size" | "notNull" | "defaultValue" | "postgresType">>;

export type RenameOptions = { regex?: boolean; caseSensitive?: boolean };

export type Rename = ColumnRef & { before: string; after: string };

export function findColumns(schema: Schema, { text = "", type, tableId }: ColumnFilter): ColumnRef[] {
  const needle = text.trim().toLowerCase();
  return schema.tables
    .filter((table) => !tableId || table.id === tableId)
    .flatMap((table) =>
      table.columns
        .filter((column) => (!type || column.type === type) && (!needle || `${table.name}.${column.name}`.toLowerCase().includes(needle)))
        .map((column) => ({ tableId: table.id, columnId: column.id })),
    );
}

/** `fn` applied to every referenced column; everything else keeps its identity. */
function mapColumns(schema: Schema, refs: ColumnRef[], fn: (column: Column) => Column): Schema {
  const ids = new Set(refs.map((ref) => ref.columnId));
  if (!ids.size) return schema;
  return {
    ...schema,
    tables: schema.tables.map((table) =>
      table.columns.some((column) => ids.has(column.id)) ? { ...table, columns: table.columns.map((column) => (ids.has(column.id) ? fn(column) : column)) } : table,
    ),
  };
}

/**
 * Only the properties present in `patch` change. A type that takes no size
 * drops the size with it, the rule `patchColumn` applies to a single column.
 */
export function patchColumns(schema: Schema, refs: ColumnRef[], patch: BulkColumnPatch): Schema {
  return mapColumns(schema, refs, (column) => {
    const next = { ...column, ...patch };
    return typeUsesSize(next.type) ? next : { ...next, size: "" };
  });
}

/**
 * Plain text replaces every occurrence; a regex replaces every match and may
 * use `$1` groups. Only columns whose name actually changes are reported, so
 * the preview lists exactly what applying will do.
 */
export function renameColumns(
  schema: Schema,
  refs: ColumnRef[],
  find: string,
  replace: string,
  { regex = false, caseSensitive = false }: RenameOptions = {},
): { schema: Schema; renames: Rename[]; error?: string } {
  if (!find) return { schema, renames: [] };
  let pattern: RegExp;
  try {
    pattern = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch (error) {
    return { schema, renames: [], error: error instanceof Error ? error.message : "Invalid pattern." };
  }
  // A plain search must not read `$&` in the replacement as a back-reference.
  const replacement = regex ? replace : replace.replace(/\$/g, "$$$$");
  const wanted = new Set(refs.map((ref) => ref.columnId));
  const renames = schema.tables.flatMap((table) =>
    table.columns
      .filter((column) => wanted.has(column.id))
      .map((column) => ({ tableId: table.id, columnId: column.id, before: column.name, after: column.name.replace(pattern, replacement) }))
      .filter((rename) => rename.after !== rename.before),
  );
  const names = new Map(renames.map((rename) => [rename.columnId, rename.after]));
  return { schema: mapColumns(schema, renames, (column) => ({ ...column, name: names.get(column.id) ?? column.name })), renames };
}
