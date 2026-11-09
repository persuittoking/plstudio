import { findColumn, findTable, type AppendResult, type ParseResult } from "./parser";
import { APPEND_GAP, contentEdges, KEY_STRATEGIES, makeColumn, nextId, normalizeGroups, normalizeColumnTemplates, normalizeLint, normalizeMemos, normalizePackages, normalizeQueries, normalizeRelationships, normalizeTables, ORACLE_TYPES, PALETTE, SCHEMA_FORMAT_VERSION, type Column, type ForeignKeyRef, type KeyStrategy, type OracleType, type Relationship, type Schema, type SchemaGroup, type Table, type TableIndex, type UniqueConstraint } from "./schema";

/**
 * The lossless counterpart to `generateDDL`. DDL carries none of the canvas --
 * no coordinates, no colours, no groups or memos -- so a diagram cannot survive
 * a SQL round trip. This format is the save file: the whole `Schema`, wrapped
 * in an envelope that says what wrote it and when.
 *
 * `formatVersion` versions the *envelope* and is independent of
 * `SCHEMA_FORMAT_VERSION`, which versions the schema inside it.
 */
export const EXPORT_FORMAT_VERSION = 1 as const;
export const EXPORT_APP = "oracle-schema-designer" as const;

export type SchemaExport = {
  formatVersion: number;
  exportedAt: string;
  app: string;
  schema: Omit<Schema, "id" | "revision" | "updatedAt">;
};

/**
 * `exportedAt` is a parameter rather than always `now` so a test can assert on
 * the whole envelope.
 */
export function exportSchemaJson(schema: Schema, exportedAt = new Date().toISOString()) {
  return JSON.stringify(
    {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt,
      app: EXPORT_APP,
      /*
       * Named field by field, not spread: `id` and `revision` address one
       * project on one server and mean nothing in a file, and listing the rest
       * keeps the format an explicit decision rather than whatever `Schema`
       * happens to hold. The `?? []` coercions mean a reader never has to tell
       * "absent" from "empty".
       */
      schema: {
        name: schema.name,
        schemaFormatVersion: SCHEMA_FORMAT_VERSION,
        tables: schema.tables,
        groups: schema.groups ?? [],
        relationships: schema.relationships ?? [],
        memos: schema.memos ?? [],
        queries: schema.queries ?? [],
        columnTemplates: schema.columnTemplates ?? [],
        packages: schema.packages ?? [],
        documentation: schema.documentation ?? "",
        dialect: schema.dialect ?? "oracle",
        ...(schema.lint?.disabled.length ? { lint: schema.lint } : {}),
      },
    } satisfies SchemaExport,
    null,
    2,
  );
}

const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

function readForeignKey(value: unknown): ForeignKeyRef | null {
  const raw = record(value);
  if (!raw || typeof raw.tableId !== "string" || !raw.tableId || typeof raw.columnId !== "string" || !raw.columnId) return null;
  return { tableId: raw.tableId, columnId: raw.columnId };
}

/**
 * An unknown type becomes VARCHAR2 rather than dropping the column: a missing
 * column silently breaks whatever primary key or relationship named it, which
 * is far harder to notice than a wrong type sitting in plain sight on the card.
 */
function readColumn(value: unknown, table: string, index: number, warnings: string[]): Column | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== "string" || !raw.id) return null;
  const known = ORACLE_TYPES.includes(raw.type as OracleType);
  const name = str(raw.name).trim() || `COLUMN_${index + 1}`;
  if (!known && raw.type !== undefined) warnings.push(`${table}.${name}: unknown type ${JSON.stringify(raw.type)}, imported as VARCHAR2.`);
  return makeColumn({
    id: raw.id,
    name,
    type: known ? (raw.type as OracleType) : "VARCHAR2",
    size: str(raw.size),
    notNull: raw.notNull === true,
    pk: raw.pk === true,
    unique: raw.unique === true,
    defaultValue: str(raw.defaultValue),
    check: str(raw.check),
    comment: typeof raw.comment === "string" ? raw.comment : undefined,
    fk: readForeignKey(raw.fk),
    ...(typeof raw.postgresType === "string" && raw.postgresType ? { postgresType: raw.postgresType } : {}),
  });
}

/** Shape-checked only; `normalizeTables` is what prunes members and empties. */
function readColumnSets<T extends UniqueConstraint | TableIndex>(value: unknown): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sets = value.flatMap((item): T[] => {
    const raw = record(item);
    if (!raw || typeof raw.id !== "string" || !raw.id || !Array.isArray(raw.columnIds)) return [];
    return [{
      id: raw.id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : undefined,
      columnIds: raw.columnIds.filter((columnId): columnId is string => typeof columnId === "string"),
    } as T];
  });
  return sets.length ? sets : undefined;
}

function readTable(value: unknown, index: number, warnings: string[]): Table | null {
  const raw = record(value);
  if (!raw || typeof raw.id !== "string" || !raw.id) {
    warnings.push(`Dropped a table with no id (position ${index + 1}).`);
    return null;
  }
  const name = str(raw.name).trim() || `TABLE_${index + 1}`;
  const color = record(raw.color);
  const seen = new Set<string>();
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).flatMap((column, position) => {
    const parsed = readColumn(column, name, position, warnings);
    if (!parsed) return [];
    if (seen.has(parsed.id)) {
      warnings.push(`${name}.${parsed.name}: dropped a duplicate column id.`);
      return [];
    }
    seen.add(parsed.id);
    return [parsed];
  });
  if (!columns.length) warnings.push(`${name}: imported with no columns.`);
  return {
    id: raw.id,
    name,
    x: num(raw.x, 80 + index * 40),
    y: num(raw.y, 80 + index * 40),
    color: color && typeof color.a === "string" && typeof color.b === "string" ? { a: color.a, b: color.b } : PALETTE[index % PALETTE.length],
    keyStrategy: KEY_STRATEGIES.includes(raw.keyStrategy as KeyStrategy) ? (raw.keyStrategy as KeyStrategy) : "none",
    schemaId: typeof raw.schemaId === "string" ? raw.schemaId : undefined,
    comment: typeof raw.comment === "string" ? raw.comment : undefined,
    // `normalizeTables` clamps whatever survives; anything unusable degrades to auto.
    width: typeof raw.width === "number" && Number.isFinite(raw.width) ? raw.width : undefined,
    columns,
    uniques: readColumnSets<UniqueConstraint>(raw.uniques),
    indexes: readColumnSets<TableIndex>(raw.indexes),
  };
}

/**
 * Read an export back into a `Schema`.
 *
 * The structural checks below are the only hard gate, and they exist for one
 * reason: `normalizeTables`/`normalizeGroups`/`normalizeRelationships` take a
 * `Schema`, not `unknown`, and throw outright on a missing `tables` array.
 * Past that gate they are already defensive about every element they walk, so
 * everything else here repairs rather than rejects -- a diagram written by an
 * older build has to keep opening.
 */
export function parseSchemaJson(text: string): ParseResult {
  const warnings: string[] = [];
  const fail = (message: string): ParseResult => ({ schema: null, warnings, errors: [message] });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("Not valid JSON. Paste or open a file exported from the JSON tab.");
  }
  const envelope = record(parsed);
  if (!envelope) return fail('Expected a JSON object with a "schema" field.');

  const version = envelope.formatVersion;
  let rawSchema: Record<string, unknown> | null;
  if (version === undefined) {
    // A bare schema -- a project file lifted out of DATA_DIR, or a hand-edit.
    if (!Array.isArray(envelope.tables)) return fail('Expected an export object with "formatVersion" and "schema".');
    warnings.push("No export envelope found; imported the object as a schema.");
    rawSchema = envelope;
  } else if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return fail("Unrecognised export format version.");
  } else if (version > EXPORT_FORMAT_VERSION) {
    return fail(`Exported by a newer version of the app (format ${version}). Update the app to import this file.`);
  } else {
    rawSchema = record(envelope.schema);
    if (!rawSchema) return fail("The export contains no schema.");
  }
  if (!Array.isArray(rawSchema.tables)) return fail("The export has no tables array.");

  const savedVersion = rawSchema.schemaFormatVersion;
  if (typeof savedVersion === "number" && savedVersion > SCHEMA_FORMAT_VERSION) warnings.push(`Saved by a newer schema format (${savedVersion}); some fields may be ignored.`);

  /*
   * Nothing else dedupes table or column ids -- `normalizeGroups` does it for
   * groups alone -- and a repeat makes the id lookups in
   * `normalizeRelationships` ambiguous and gives React two cards with one key.
   */
  const seen = new Set<string>();
  const tables = rawSchema.tables.flatMap((value, index) => {
    const table = readTable(value, index, warnings);
    if (!table) return [];
    if (seen.has(table.id)) {
      warnings.push(`${table.name}: dropped a duplicate table id.`);
      return [];
    }
    seen.add(table.id);
    return [table];
  });

  const schema: Schema = {
    // A placeholder: the project keeps its own id, and the caller substitutes it.
    id: nextId("schema"),
    name: str(rawSchema.name).trim() || "Imported Diagram",
    revision: 1,
    schemaFormatVersion: SCHEMA_FORMAT_VERSION,
    tables,
    // Validated element by element by the normalizers on the next line.
    groups: Array.isArray(rawSchema.groups) ? (rawSchema.groups as SchemaGroup[]) : [],
    relationships: Array.isArray(rawSchema.relationships) ? (rawSchema.relationships as Relationship[]) : [],
    memos: normalizeMemos(rawSchema.memos),
    queries: normalizeQueries(rawSchema.queries),
    columnTemplates: normalizeColumnTemplates(rawSchema.columnTemplates),
    packages: normalizePackages(rawSchema.packages, tables.map((table) => table.id)),
    ...(str(rawSchema.documentation) ? { documentation: str(rawSchema.documentation) } : {}),
    ...(rawSchema.dialect === "postgres" ? { dialect: "postgres" as const } : {}),
    ...normalizeLint(rawSchema.lint),
  };
  /*
   * `prepareCanvasSchema`'s pipeline minus `repairInitialLayout`: that one
   * de-overlaps cards, and the whole point of this format is that the diagram
   * comes back where the user left it.
   */
  return { schema: normalizeTables(normalizeGroups(normalizeRelationships(schema))), warnings, errors: [] };
}

/**
 * The other half of import: keep the diagram and land the file's tables under
 * it, mirroring `appendCreateTable`. It differs in four ways, all because a
 * JSON export carries real ids and real canvas state where a DDL script carries
 * neither:
 *
 * - every id is re-minted, so merging a file into the project it came from (or
 *   twice over) cannot collide;
 * - an unresolvable foreign key becomes `null` rather than passing through --
 *   the DDL path can pass one through because the parser already resolved it
 *   against the project, but here it is an id from somewhere else entirely;
 * - the file's table colours are kept, because the user chose them;
 * - groups and memos come too, though only groups that an added table is
 *   actually in, since an empty imported rectangle is noise.
 *
 * As in the DDL path, a name the project already carries is not overwritten:
 * the project's table wins and the file's is reported as skipped. Matching is
 * by name and never by id, so the behaviour is the one the user can see.
 */
export function mergeSchemaJson(base: Schema, text: string): AppendResult {
  const parsed = parseSchemaJson(text);
  if (!parsed.schema) return { schema: null, added: [], skipped: [], warnings: parsed.warnings, errors: parsed.errors };
  const incoming = parsed.schema;
  if (!incoming.tables.length) return { schema: null, added: [], skipped: [], warnings: parsed.warnings, errors: ["The export has no tables to add."] };

  /** Imported table id -> the project table of the same name it defers to. */
  const deferred = new Map<string, Table>();
  /** Column id inside a deferred table -> the project column of the same name. */
  const deferredColumns = new Map<string, string>();
  const skipped: string[] = [];
  const fresh: Table[] = [];
  incoming.tables.forEach((table) => {
    const match = findTable(base.tables, table.name);
    if (!match) {
      fresh.push(table);
      return;
    }
    skipped.push(match.name);
    deferred.set(table.id, match);
    table.columns.forEach((column) => {
      const twin = findColumn(match, column.name);
      if (twin) deferredColumns.set(column.id, twin.id);
    });
  });

  if (!fresh.length)
    return {
      schema: null,
      added: [],
      skipped,
      warnings: parsed.warnings,
      errors: [`Already in this project: ${skipped.join(", ")}. Nothing new to add.`],
    };

  const groups = (incoming.groups ?? []).filter((group) => fresh.some((table) => table.schemaId === group.id));
  const memos = incoming.memos ?? [];
  // A package comes along when it covers an added table; one the project already has by name defers to it.
  const taken = new Set((base.packages ?? []).map((pkg) => pkg.name.trim().toLowerCase()));
  const packages = (incoming.packages ?? []).filter((pkg) => !taken.has(pkg.name.trim().toLowerCase()) && pkg.tableIds.some((id) => fresh.some((table) => table.id === id)));
  /*
   * Three maps, not one: a hand-written file may well use the same string as a
   * table id and a column id, and a flat map could not tell them apart.
   * Relationship and memo ids are referenced by nothing, so they are minted
   * where they are used. Skipped tables are absent here on purpose -- their
   * references resolve through `deferred` instead.
   */
  const tableIds = new Map(fresh.map((table) => [table.id, nextId("tbl")] as const));
  const columnIds = new Map(fresh.flatMap((table) => table.columns.map((column) => [column.id, nextId("col")] as const)));
  const groupIds = new Map(groups.map((group) => [group.id, nextId("group")] as const));

  const rewire = (ref: ForeignKeyRef | null): ForeignKeyRef | null => {
    if (!ref) return null;
    const minted = tableIds.get(ref.tableId);
    if (minted) {
      const columnId = columnIds.get(ref.columnId);
      return columnId ? { tableId: minted, columnId } : null;
    }
    const target = deferred.get(ref.tableId);
    const columnId = target && deferredColumns.get(ref.columnId);
    return target && columnId ? { tableId: target.id, columnId } : null;
  };

  // Groups and memos join the origin, or one sitting above the topmost table shifts away from it.
  const edges = contentEdges(base);
  const originX = Math.min(...fresh.map((table) => table.x), ...groups.map((group) => group.x), ...memos.map((memo) => memo.x), ...packages.map((pkg) => pkg.x));
  const originY = Math.min(...fresh.map((table) => table.y), ...groups.map((group) => group.y), ...memos.map((memo) => memo.y), ...packages.map((pkg) => pkg.y));
  const dx = edges ? edges.left - originX : 0;
  const dy = edges ? edges.bottom + APPEND_GAP - originY : 0;

  const added = fresh.map((table) => ({
    ...table,
    id: tableIds.get(table.id) ?? table.id,
    x: table.x + dx,
    y: table.y + dy,
    schemaId: table.schemaId ? groupIds.get(table.schemaId) : undefined,
    columns: table.columns.map((column) => ({ ...column, id: columnIds.get(column.id) ?? column.id, fk: rewire(column.fk) })),
    // Re-minted like every other id here; a constraint still holding the file's
    // originals would name nothing and be pruned away on the next normalize.
    uniques: table.uniques?.map((constraint) => ({
      ...constraint,
      id: nextId("uk"),
      columnIds: constraint.columnIds.map((columnId) => columnIds.get(columnId) ?? columnId),
    })),
    indexes: table.indexes?.map((index) => ({
      ...index,
      id: nextId("idx"),
      columnIds: index.columnIds.map((columnId) => columnIds.get(columnId) ?? columnId),
    })),
  }));
  const addedGroups = groups.map((group) => ({ ...group, id: groupIds.get(group.id) ?? group.id, x: group.x + dx, y: group.y + dy }));
  const addedMemos = memos.map((memo) => ({ ...memo, id: nextId("memo"), x: memo.x + dx, y: memo.y + dy }));
  const addedPackages = packages.map((pkg) => ({
    ...pkg,
    id: nextId("package"),
    x: pkg.x + dx,
    y: pkg.y + dy,
    tableIds: pkg.tableIds.flatMap((id) => tableIds.get(id) ?? deferred.get(id)?.id ?? []),
    procedures: pkg.procedures.map((proc) => ({ ...proc, id: nextId("proc") })),
  }));
  // A query names tables, not ids, so it needs nothing rewired -- only its own id.
  const addedQueries = (incoming.queries ?? []).map((query) => ({ ...query, id: nextId("query") }));

  const relationships = (incoming.relationships ?? [])
    // A relationship owned by a skipped table describes the project's table, not the file's.
    .filter((relationship) => tableIds.has(relationship.startTableId))
    .map((relationship) => ({
      ...relationship,
      id: nextId("rel"),
      startTableId: tableIds.get(relationship.startTableId) ?? relationship.startTableId,
      startFieldId: columnIds.get(relationship.startFieldId) ?? relationship.startFieldId,
      endTableId: tableIds.get(relationship.endTableId) ?? deferred.get(relationship.endTableId)?.id ?? relationship.endTableId,
      endFieldId: columnIds.get(relationship.endFieldId) ?? deferredColumns.get(relationship.endFieldId) ?? relationship.endFieldId,
      fields: relationship.fields.map((pair) => ({
        startFieldId: columnIds.get(pair.startFieldId) ?? pair.startFieldId,
        endFieldId: columnIds.get(pair.endFieldId) ?? deferredColumns.get(pair.endFieldId) ?? pair.endFieldId,
      })),
    }));

  /*
   * `normalizeRelationships` drops every `column.fk` no relationship accounts
   * for. On a schema whose relationships were never materialised that would
   * quietly cut the project's own foreign keys, so derive them first.
   */
  const ground = base.relationships?.length ? base : normalizeRelationships(base);
  // The outer `normalizeGroups` is what checks the re-minted `schemaId`s against the merged groups.
  const schema = normalizeGroups(
    normalizeRelationships({
      ...ground,
      tables: [...ground.tables, ...added],
      groups: [...(ground.groups ?? []), ...addedGroups],
      memos: [...(ground.memos ?? []), ...addedMemos],
      queries: [...(ground.queries ?? []), ...addedQueries],
      packages: [...(ground.packages ?? []), ...addedPackages],
      relationships: [...(ground.relationships ?? []), ...relationships],
    }),
  );
  return { schema, added, skipped, warnings: parsed.warnings, errors: [] };
}
