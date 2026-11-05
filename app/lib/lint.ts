import {
  makeColumn,
  makeIndex,
  normalizeIdentifier,
  normalizeRelationships,
  primaryKeyColumns,
  tableKeys,
  type Column,
  type Relationship,
  type Schema,
  type Table,
} from "./schema";

/**
 * Design advice, as opposed to `validateSchema`'s "Oracle will reject this".
 *
 * A finding never blocks anything. Its fix is *data*, not a closure: findings
 * are computed from a deferred snapshot, so `applyLintFix` re-lints the schema
 * the fix is about to land on and does nothing unless the same finding is
 * still there -- a collaborator who fixed it first wins, and nothing stale is
 * written over their edit.
 */
export type LintFamily = "indexes" | "keys" | "types" | "naming";

export type LintFix =
  | { kind: "addIndex"; tableId: string; columnIds: string[] }
  | { kind: "addPrimaryKey"; tableId: string }
  | { kind: "patchColumn"; tableId: string; columnId: string; patch: Partial<Pick<Column, "notNull" | "unique" | "type" | "size">> }
  | { kind: "renameTable"; tableId: string; name: string }
  | { kind: "renameColumn"; tableId: string; columnId: string; name: string };

export type LintFinding = {
  severity: "suggestion";
  ruleId: LintRuleId;
  /** Stable across re-lints of an unchanged problem: what `applyLintFix` matches on. */
  key: string;
  message: string;
  tableId: string;
  columnId?: string;
  fix?: LintFix & { label: string };
};

type LintContext = {
  tables: Table[];
  byId: Map<string, Table>;
  relationships: Relationship[];
  /** Column ids on either end of some relationship -- retyping one would break the FK's type match. */
  related: Set<string>;
};

type Rule = { id: string; family: LintFamily; title: string; run: (ctx: LintContext) => Omit<LintFinding, "severity" | "ruleId" | "key">[] };

const LOB_TYPES = new Set(["CLOB", "NCLOB", "BLOB", "BFILE"]);
/** The standard (non-EXTENDED) byte limits; NVARCHAR2's is in characters of a 2-byte national set. */
const STRING_LIMITS: Record<string, number> = { VARCHAR2: 4000, NVARCHAR2: 2000, RAW: 2000 };

const pairsOf = (relationship: Relationship) =>
  relationship.fields.length ? relationship.fields : [{ startFieldId: relationship.startFieldId, endFieldId: relationship.endFieldId }];
const columnOf = (table: Table | undefined, id: string) => table?.columns.find((column) => column.id === id);
/** Whether some key's leading columns are exactly `columnIds`, in any order -- all Oracle needs to avoid the child-table lock. */
const leadsWith = (key: string[], columnIds: string[]) =>
  key.length >= columnIds.length && columnIds.every((id) => key.slice(0, columnIds.length).includes(id));
/** Whether a PK or unique constraint (not a plain index) enforces uniqueness on exactly `columnIds`, or on a subset of them. */
const isUniqueOn = (table: Table, columnIds: string[]) =>
  [primaryKeyColumns(table).map((column) => column.id), ...table.columns.filter((column) => column.unique).map((column) => [column.id]), ...(table.uniques ?? []).map((constraint) => constraint.columnIds)]
    .some((key) => key.length > 0 && key.every((id) => columnIds.includes(id)));
const snakeCase = (name: string) => name.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

const RULES = [
  {
    id: "fk-unindexed",
    family: "indexes",
    title: "Foreign keys without an index",
    run: ({ byId, relationships }) => relationships.flatMap((relationship) => {
      const table = byId.get(relationship.startTableId);
      const columnIds = pairsOf(relationship).map((pair) => pair.startFieldId);
      if (!table || tableKeys(table).some((key) => leadsWith(key.columnIds, columnIds))) return [];
      const names = columnIds.map((id) => columnOf(table, id)?.name ?? "?").join(", ");
      return [{
        message: `${table.name}: foreign key on ${names} has no index, so deleting or re-keying a parent row locks all of ${table.name}.`,
        tableId: table.id,
        columnId: columnIds.length === 1 ? columnIds[0] : undefined,
        fix: { kind: "addIndex", tableId: table.id, columnIds, label: "Add index" },
      }];
    }),
  },
  {
    id: "table-no-pk",
    family: "keys",
    title: "Tables without a primary key",
    run: ({ tables }) => tables.filter((table) => !primaryKeyColumns(table).length).map((table) => ({
      message: `${table.name} has no primary key, so rows cannot be referenced or reliably updated.`,
      tableId: table.id,
      fix: { kind: "addPrimaryKey", tableId: table.id, label: table.columns.some((column) => normalizeIdentifier(column.name) === "ID") ? "Make ID the key" : "Add ID key" },
    })),
  },
  {
    id: "set-null-not-null",
    family: "keys",
    title: "ON DELETE SET NULL on a NOT NULL column",
    run: ({ byId, relationships }) => relationships.filter((relationship) => relationship.deleteConstraint === "Set null").flatMap((relationship) => {
      const table = byId.get(relationship.startTableId);
      return pairsOf(relationship).map((pair) => columnOf(table, pair.startFieldId)).filter((column): column is Column => Boolean(column && (column.notNull || column.pk))).map((column) => ({
        message: `${table!.name}.${column.name}: ON DELETE SET NULL cannot null a NOT NULL column; deleting the parent row will fail.`,
        tableId: table!.id,
        columnId: column.id,
        fix: column.pk ? undefined : { kind: "patchColumn", tableId: table!.id, columnId: column.id, patch: { notNull: false }, label: "Allow nulls" },
      }));
    }),
  },
  {
    id: "one-to-one-not-unique",
    family: "keys",
    title: "One-to-one relationships without a unique key",
    run: ({ byId, relationships }) => relationships.filter((relationship) => relationship.cardinality === "one_to_one").flatMap((relationship) => {
      const table = byId.get(relationship.startTableId);
      const columnIds = pairsOf(relationship).map((pair) => pair.startFieldId);
      if (!table || isUniqueOn(table, columnIds)) return [];
      const single = columnIds.length === 1 ? columnOf(table, columnIds[0]) : undefined;
      return [{
        message: `${table.name}: one-to-one relationship ${relationship.name} is not enforced; its foreign key columns are not unique.`,
        tableId: table.id,
        columnId: single?.id,
        fix: single ? { kind: "patchColumn", tableId: table.id, columnId: single.id, patch: { unique: true }, label: "Make unique" } : undefined,
      }];
    }),
  },
  {
    id: "char-fixed-width",
    family: "types",
    title: "Fixed-width CHAR longer than one",
    run: ({ tables, related }) => tables.flatMap((table) => table.columns.filter((column) => (column.type === "CHAR" || column.type === "NCHAR") && Number(column.size) > 1).map((column) => {
      const type = column.type === "CHAR" ? "VARCHAR2" : "NVARCHAR2";
      return {
        message: `${table.name}.${column.name}: ${column.type}(${column.size}) blank-pads every value to full width; ${type} is usually what is meant.`,
        tableId: table.id,
        columnId: column.id,
        fix: related.has(column.id) ? undefined : { kind: "patchColumn", tableId: table.id, columnId: column.id, patch: { type }, label: `Use ${type}` },
      };
    })),
  },
  {
    id: "date-for-timestamp",
    family: "types",
    title: "DATE on a timestamp-like column",
    run: ({ tables }) => tables.flatMap((table) => table.columns.filter((column) => column.type === "DATE" && /(?:_AT|_TS|_TIME|TIMESTAMP)$/.test(normalizeIdentifier(column.name))).map((column) => ({
      message: `${table.name}.${column.name}: the name suggests a point in time, but DATE keeps only whole seconds; consider TIMESTAMP.`,
      tableId: table.id,
      columnId: column.id,
    }))),
  },
  {
    id: "string-extended",
    family: "types",
    title: "Strings past the standard size limit",
    run: ({ tables }) => tables.flatMap((table) => table.columns.filter((column) => column.type in STRING_LIMITS && Number(column.size) > STRING_LIMITS[column.type]).map((column) => ({
      message: `${table.name}.${column.name}: ${column.type}(${column.size}) is over ${STRING_LIMITS[column.type]} and needs MAX_STRING_SIZE = EXTENDED on the database.`,
      tableId: table.id,
      columnId: column.id,
    }))),
  },
  {
    id: "lob-in-key",
    family: "types",
    title: "LOB columns in a key or index",
    run: ({ tables }) => tables.flatMap((table) => {
      const keyed = new Set(tableKeys(table).flatMap((key) => key.columnIds));
      return table.columns.filter((column) => LOB_TYPES.has(column.type) && keyed.has(column.id)).map((column) => ({
        message: `${table.name}.${column.name}: ${column.type} columns cannot be part of a primary key, unique constraint or B-tree index.`,
        tableId: table.id,
        columnId: column.id,
      }));
    }),
  },
  {
    id: "fk-name",
    family: "naming",
    title: "Foreign key columns not named after their target",
    run: ({ byId, relationships }) => relationships.filter((relationship) => pairsOf(relationship).length === 1).flatMap((relationship) => {
      const table = byId.get(relationship.startTableId);
      const target = byId.get(relationship.endTableId);
      const column = columnOf(table, relationship.startFieldId);
      const targetColumn = columnOf(target, relationship.endFieldId);
      if (!table || !target || !column || !targetColumn || column.pk) return [];
      const suffix = `_${normalizeIdentifier(targetColumn.name)}`;
      if (normalizeIdentifier(column.name).endsWith(suffix)) return [];
      const name = `${normalizeIdentifier(target.name)}${suffix}`;
      const free = !table.columns.some((other) => other.id !== column.id && normalizeIdentifier(other.name) === name);
      return [{
        message: `${table.name}.${column.name}: references ${target.name}.${targetColumn.name}; the convention is a name ending in ${suffix}, such as ${name}.`,
        tableId: table.id,
        columnId: column.id,
        fix: free ? { kind: "renameColumn", tableId: table.id, columnId: column.id, name, label: `Rename to ${name}` } : undefined,
      }];
    }),
  },
  {
    id: "camel-case-name",
    family: "naming",
    title: "camelCase names",
    run: ({ tables }) => tables.flatMap((table) => {
      const camel = (name: string) => /[a-z0-9][A-Z]/.test(name);
      const taken = (name: string, except: string) => table.columns.some((column) => column.id !== except && normalizeIdentifier(column.name) === name);
      const own = camel(table.name) && !tables.some((other) => other.id !== table.id && normalizeIdentifier(other.name) === snakeCase(table.name))
        ? [{ message: `${table.name}: Oracle uppercases unquoted names, so this becomes ${normalizeIdentifier(table.name)}; use ${snakeCase(table.name)}.`, tableId: table.id, fix: { kind: "renameTable" as const, tableId: table.id, name: snakeCase(table.name), label: `Rename to ${snakeCase(table.name)}` } }]
        : [];
      return [...own, ...table.columns.filter((column) => camel(column.name)).map((column) => ({
        message: `${table.name}.${column.name}: Oracle uppercases unquoted names, so this becomes ${normalizeIdentifier(column.name)}; use ${snakeCase(column.name)}.`,
        tableId: table.id,
        columnId: column.id,
        fix: taken(snakeCase(column.name), column.id) ? undefined : { kind: "renameColumn" as const, tableId: table.id, columnId: column.id, name: snakeCase(column.name), label: `Rename to ${snakeCase(column.name)}` },
      }))];
    }),
  },
  {
    id: "table-no-comment",
    family: "naming",
    title: "Tables without a comment",
    run: ({ tables }) => tables.filter((table) => !table.comment?.trim()).map((table) => ({
      message: `${table.name} has no comment; COMMENT ON TABLE is what documents it in the data dictionary.`,
      tableId: table.id,
    })),
  },
  {
    id: "orphan-table",
    family: "naming",
    title: "Tables with no relationships",
    run: ({ tables, relationships }) => {
      if (tables.length < 2) return [];
      const linked = new Set(relationships.flatMap((relationship) => [relationship.startTableId, relationship.endTableId]));
      return tables.filter((table) => !linked.has(table.id)).map((table) => ({ message: `${table.name} is not related to any other table.`, tableId: table.id }));
    },
  },
] as const satisfies readonly Rule[];

export type LintRuleId = (typeof RULES)[number]["id"];
export const LINT_RULES: ReadonlyArray<{ id: LintRuleId; family: LintFamily; title: string }> = RULES.map(({ id, family, title }) => ({ id, family, title }));
export const LINT_FAMILIES: Record<LintFamily, string> = { indexes: "Indexes", keys: "Keys and nullability", types: "Type choices", naming: "Naming and docs" };

export function lintSchema(schema: Schema): LintFinding[] {
  const disabled = new Set(schema.lint?.disabled ?? []);
  const byId = new Map<string, Table>();
  schema.tables.forEach((table) => { if (!byId.has(table.id)) byId.set(table.id, table); });
  // The designer's schema already carries canonical relationships; only a bare `Column.fk` diagram needs deriving.
  const relationships = (schema.relationships?.length ? schema.relationships : normalizeRelationships(schema).relationships ?? [])
    .filter((relationship) => byId.has(relationship.startTableId) && byId.has(relationship.endTableId));
  const related = new Set(relationships.flatMap((relationship) => pairsOf(relationship).flatMap((pair) => [pair.startFieldId, pair.endFieldId])));
  const ctx: LintContext = { tables: [...byId.values()], byId, relationships, related };
  return RULES.filter((rule) => !disabled.has(rule.id)).flatMap((rule) =>
    (rule.run(ctx) as Omit<LintFinding, "severity" | "ruleId" | "key">[]).map((finding) => ({
      ...finding,
      severity: "suggestion" as const,
      ruleId: rule.id,
      key: [rule.id, finding.tableId, finding.columnId ?? "", finding.fix?.kind === "addIndex" ? finding.fix.columnIds.join("+") : ""].join(":"),
    })),
  );
}

const patchTable = (schema: Schema, tableId: string, mutate: (table: Table) => Table): Schema =>
  ({ ...schema, tables: schema.tables.map((table) => (table.id === tableId ? mutate(table) : table)) });
const patchColumn = (table: Table, columnId: string, patch: Partial<Column>): Table =>
  ({ ...table, columns: table.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column)) });

/** `finding.fix` applied to `schema` -- or `schema` itself when the finding no longer holds there. */
export function applyLintFix(schema: Schema, finding: LintFinding): Schema {
  const { fix } = finding;
  if (!fix || !lintSchema(schema).some((current) => current.key === finding.key)) return schema;
  switch (fix.kind) {
    case "addIndex":
      return patchTable(schema, fix.tableId, (table) => ({ ...table, indexes: [...(table.indexes ?? []), makeIndex(fix.columnIds)] }));
    case "addPrimaryKey":
      return patchTable(schema, fix.tableId, (table) => {
        const id = table.columns.find((column) => normalizeIdentifier(column.name) === "ID");
        return id
          ? patchColumn(table, id.id, { pk: true, notNull: true })
          : { ...table, columns: [makeColumn({ name: "ID", type: "NUMBER", size: "", notNull: true, pk: true }), ...table.columns] };
      });
    case "patchColumn":
      return patchTable(schema, fix.tableId, (table) => patchColumn(table, fix.columnId, fix.patch));
    case "renameTable":
      return patchTable(schema, fix.tableId, (table) => ({ ...table, name: fix.name }));
    case "renameColumn":
      return patchTable(schema, fix.tableId, (table) => patchColumn(table, fix.columnId, { name: fix.name }));
  }
}
