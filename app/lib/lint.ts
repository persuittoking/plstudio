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
  type Dialect,
  type Table,
} from "./schema";
import { pgExtraOf } from "./pg-types";
import { isPgReserved, nativePgType, PG_NAME_LIMIT } from "./postgres";

/**
 * Design advice, as opposed to `validateSchema`'s "Oracle will reject this".
 *
 * A PostgreSQL diagram (`Schema.dialect`) gets PostgreSQL's advice: the rules
 * both databases share speak in PostgreSQL's terms and types, Oracle-only
 * rules are left out, and PostgreSQL's own (`json` vs `jsonb`, `serial`,
 * `money`, `timestamptz`, reserved words) are added. Fixes still write the
 * Oracle types columns are stored as (see `app/lib/dialect.ts`).
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
  | { kind: "patchColumn"; tableId: string; columnId: string; patch: Partial<Pick<Column, "notNull" | "unique" | "type" | "size" | "postgresType">> }
  /** PostgreSQL: a serial key becomes a plain integer of the same width, made by the table's identity. */
  | { kind: "useIdentity"; tableId: string; columnId: string }
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
  /** A PostgreSQL diagram: messages name PostgreSQL's types and behaviour. */
  postgres: boolean;
};

type Rule = {
  id: string;
  family: LintFamily;
  title: string;
  /** The title a PostgreSQL diagram's Rules menu shows, when it differs. */
  pgTitle?: string;
  /** The databases the rule speaks to; absent means both. */
  dialects?: readonly Dialect[];
  run: (ctx: LintContext) => Omit<LintFinding, "severity" | "ruleId" | "key">[];
};

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
/** A point in time, by its name: `CREATED_AT`, `LOGIN_TIME`. */
const TIME_LIKE = /(?:_AT|_TS|_TIME|TIMESTAMP)$/;
const SERIAL_WIDTH: Record<string, string> = { smallserial: "smallint", serial: "integer", bigserial: "bigint" };

const RULES = [
  {
    id: "fk-unindexed",
    family: "indexes",
    title: "Foreign keys without an index",
    run: (ctx) => ctx.relationships.flatMap((relationship) => {
      const table = ctx.byId.get(relationship.startTableId);
      const columnIds = pairsOf(relationship).map((pair) => pair.startFieldId);
      if (!table || tableKeys(table).some((key) => leadsWith(key.columnIds, columnIds))) return [];
      const names = columnIds.map((id) => columnOf(table, id)?.name ?? "?").join(", ");
      return [{
        message: ctx.postgres
          ? `${table.name}: foreign key on ${names} has no index. PostgreSQL never creates one for a foreign key, so deleting or re-keying a parent row scans all of ${table.name}.`
          : `${table.name}: foreign key on ${names} has no index, so deleting or re-keying a parent row locks all of ${table.name}.`,
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
    pgTitle: "Fixed-width char longer than one",
    run: ({ tables, related, postgres }) => tables.flatMap((table) => table.columns.filter((column) => (column.type === "CHAR" || column.type === "NCHAR") && Number(column.size) > 1 && !pgExtraOf(column)).map((column) => {
      const type = column.type === "CHAR" ? "VARCHAR2" : "NVARCHAR2";
      const shown = postgres ? nativePgType(column) : `${column.type}(${column.size})`;
      const target = postgres ? "varchar" : type;
      return {
        message: `${table.name}.${column.name}: ${shown} blank-pads every value to full width; ${target} is usually what is meant.`,
        tableId: table.id,
        columnId: column.id,
        fix: related.has(column.id) ? undefined : { kind: "patchColumn", tableId: table.id, columnId: column.id, patch: { type }, label: `Use ${target}` },
      };
    })),
  },
  {
    id: "date-for-timestamp",
    family: "types",
    title: "DATE on a timestamp-like column",
    pgTitle: "date on a timestamp-like column",
    run: ({ tables, related, postgres }) => tables.flatMap((table) => table.columns.filter((column) => column.type === "DATE" && TIME_LIKE.test(normalizeIdentifier(column.name))).map((column) => postgres
      // PostgreSQL's date is a calendar day: unlike Oracle's DATE, it has no time of day at all.
      ? {
        message: `${table.name}.${column.name}: the name suggests a point in time, but date stores no time of day at all; use timestamptz.`,
        tableId: table.id,
        columnId: column.id,
        fix: related.has(column.id) ? undefined : { kind: "patchColumn" as const, tableId: table.id, columnId: column.id, patch: { type: "TIMESTAMP WITH TIME ZONE" as const, size: "" }, label: "Use timestamptz" },
      }
      : {
        message: `${table.name}.${column.name}: the name suggests a point in time, but DATE keeps only whole seconds; consider TIMESTAMP.`,
        tableId: table.id,
        columnId: column.id,
      })),
  },
  {
    id: "string-extended",
    family: "types",
    title: "Strings past the standard size limit",
    dialects: ["oracle"],
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
    dialects: ["oracle"],
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
    run: ({ tables, postgres }) => tables.flatMap((table) => {
      const camel = (name: string) => /[a-z0-9][A-Z]/.test(name);
      const taken = (name: string, except: string) => table.columns.some((column) => column.id !== except && normalizeIdentifier(column.name) === name);
      // Oracle folds unquoted names to upper case, PostgreSQL to lower case: either way the capitals are lost.
      const folded = (name: string) => (postgres ? normalizeIdentifier(name).toLowerCase() : normalizeIdentifier(name));
      const why = (name: string) => postgres
        ? `PostgreSQL lowercases unquoted names, so this becomes ${folded(name)}; use ${snakeCase(name).toLowerCase()}.`
        : `Oracle uppercases unquoted names, so this becomes ${folded(name)}; use ${snakeCase(name)}.`;
      const own = camel(table.name) && !tables.some((other) => other.id !== table.id && normalizeIdentifier(other.name) === snakeCase(table.name))
        ? [{ message: `${table.name}: ${why(table.name)}`, tableId: table.id, fix: { kind: "renameTable" as const, tableId: table.id, name: snakeCase(table.name), label: `Rename to ${snakeCase(table.name)}` } }]
        : [];
      return [...own, ...table.columns.filter((column) => camel(column.name)).map((column) => ({
        message: `${table.name}.${column.name}: ${why(column.name)}`,
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
    run: ({ tables, postgres }) => tables.filter((table) => !table.comment?.trim()).map((table) => ({
      message: postgres
        ? `${table.name} has no comment; COMMENT ON TABLE is what documents it in the catalog (psql's \\dt+ shows it).`
        : `${table.name} has no comment; COMMENT ON TABLE is what documents it in the data dictionary.`,
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
  /*
   * PostgreSQL's own advice -- the "Don't Do This" list of the PostgreSQL wiki
   * and its naming rules. Each fix writes the Oracle type the PostgreSQL choice
   * is stored as, so the Oracle DDL stays valid too.
   */
  {
    id: "pg-json",
    family: "types",
    title: "json instead of jsonb",
    dialects: ["postgres"],
    run: ({ tables }) => tables.flatMap((table) => table.columns.filter((column) => pgExtraOf(column)?.id === "json").map((column) => ({
      message: `${table.name}.${column.name}: json keeps the text exactly as written and cannot be indexed or compared; jsonb is what is usually meant.`,
      tableId: table.id,
      columnId: column.id,
      fix: { kind: "patchColumn" as const, tableId: table.id, columnId: column.id, patch: { postgresType: "jsonb" }, label: "Use jsonb" },
    }))),
  },
  {
    id: "pg-serial",
    family: "keys",
    title: "serial instead of an identity column",
    dialects: ["postgres"],
    run: ({ tables }) => tables.flatMap((table) => {
      const keys = primaryKeyColumns(table);
      return table.columns.filter((column) => SERIAL_WIDTH[pgExtraOf(column)?.id ?? ""]).map((column) => {
        const plain = SERIAL_WIDTH[pgExtraOf(column)!.id];
        const soleKey = keys.length === 1 && keys[0].id === column.id;
        return {
          message: soleKey
            ? `${table.name}.${column.name}: ${pgExtraOf(column)!.id} is the old way to number rows; an identity column (${plain} generated … as identity) is the SQL-standard replacement and keeps its sequence with the table.`
            : `${table.name}.${column.name}: ${pgExtraOf(column)!.id} gives a column its own sequence; outside the primary key that is rarely meant — use ${plain}.`,
          tableId: table.id,
          columnId: column.id,
          fix: soleKey
            ? { kind: "useIdentity" as const, tableId: table.id, columnId: column.id, label: "Use identity" }
            : { kind: "patchColumn" as const, tableId: table.id, columnId: column.id, patch: { postgresType: undefined }, label: `Use ${plain}` },
        };
      });
    }),
  },
  {
    id: "pg-money",
    family: "types",
    title: "money type",
    dialects: ["postgres"],
    run: ({ tables, related }) => tables.flatMap((table) => table.columns.filter((column) => pgExtraOf(column)?.id === "money").map((column) => ({
      message: `${table.name}.${column.name}: money follows the server's lc_monetary locale and rounds to its currency's digits; numeric(19,2) holds amounts the same everywhere.`,
      tableId: table.id,
      columnId: column.id,
      fix: related.has(column.id) ? undefined : { kind: "patchColumn" as const, tableId: table.id, columnId: column.id, patch: { type: "NUMBER" as const, size: "19,2", postgresType: undefined }, label: "Use numeric(19,2)" },
    }))),
  },
  {
    id: "pg-timestamptz",
    family: "types",
    title: "timestamp without time zone on a point in time",
    dialects: ["postgres"],
    run: ({ tables, related }) => tables.flatMap((table) => table.columns.filter((column) => column.type === "TIMESTAMP" && !pgExtraOf(column) && TIME_LIKE.test(normalizeIdentifier(column.name))).map((column) => ({
      message: `${table.name}.${column.name}: timestamp has no time zone, so the same moment reads differently on servers in different zones; timestamptz is PostgreSQL's choice for a point in time.`,
      tableId: table.id,
      columnId: column.id,
      fix: related.has(column.id) ? undefined : { kind: "patchColumn" as const, tableId: table.id, columnId: column.id, patch: { type: "TIMESTAMP WITH TIME ZONE" as const, size: "" }, label: "Use timestamptz" },
    }))),
  },
  {
    id: "pg-reserved-name",
    family: "naming",
    title: "Names PostgreSQL reserves",
    dialects: ["postgres"],
    run: ({ tables }) => tables.flatMap((table) => [
      ...(isPgReserved(table.name) ? [{ message: `${table.name}: ${table.name.toLowerCase()} is a reserved word in PostgreSQL, so every query must quote it ("${table.name.toLowerCase()}"); rename it, e.g. ${normalizeIdentifier(table.name)}S.`, tableId: table.id }] : []),
      ...table.columns.filter((column) => isPgReserved(column.name)).map((column) => ({
        message: `${table.name}.${column.name}: ${column.name.toLowerCase()} is a reserved word in PostgreSQL, so every query must quote it ("${column.name.toLowerCase()}"); rename it.`,
        tableId: table.id,
        columnId: column.id,
      })),
    ]),
  },
  {
    id: "pg-long-name",
    family: "naming",
    title: "Names longer than 63 characters",
    dialects: ["postgres"],
    run: ({ tables }) => tables.flatMap((table) => [
      ...(table.name.length > PG_NAME_LIMIT ? [{ message: `${table.name}: PostgreSQL cuts names at ${PG_NAME_LIMIT} characters, so the script shortens it; choose a shorter name.`, tableId: table.id }] : []),
      ...table.columns.filter((column) => column.name.length > PG_NAME_LIMIT).map((column) => ({
        message: `${table.name}.${column.name}: PostgreSQL cuts names at ${PG_NAME_LIMIT} characters, so the script shortens it; choose a shorter name.`,
        tableId: table.id,
        columnId: column.id,
      })),
    ]),
  },
] as const satisfies readonly Rule[];

export type LintRuleId = (typeof RULES)[number]["id"];
export type LintRuleInfo = { id: LintRuleId; family: LintFamily; title: string; dialects?: readonly Dialect[] };
const dialectsOf = (rule: Rule): readonly Dialect[] | undefined => rule.dialects;
export const LINT_RULES: ReadonlyArray<LintRuleInfo> = RULES.map((rule) => ({ id: rule.id, family: rule.family, title: rule.title, dialects: dialectsOf(rule) }));
/** The rules a diagram's database has, titled for it: what its Rules menu lists. */
export const lintRulesFor = (dialect: Dialect): ReadonlyArray<LintRuleInfo> =>
  (RULES as readonly Rule[])
    .filter((rule) => !rule.dialects || rule.dialects.includes(dialect))
    .map((rule) => ({ id: rule.id as LintRuleId, family: rule.family, title: (dialect === "postgres" && rule.pgTitle) || rule.title, dialects: rule.dialects }));
export const LINT_FAMILIES: Record<LintFamily, string> = { indexes: "Indexes", keys: "Keys and nullability", types: "Type choices", naming: "Naming and docs" };

export function lintSchema(schema: Schema): LintFinding[] {
  const disabled = new Set(schema.lint?.disabled ?? []);
  const byId = new Map<string, Table>();
  schema.tables.forEach((table) => { if (!byId.has(table.id)) byId.set(table.id, table); });
  // The designer's schema already carries canonical relationships; only a bare `Column.fk` diagram needs deriving.
  const relationships = (schema.relationships?.length ? schema.relationships : normalizeRelationships(schema).relationships ?? [])
    .filter((relationship) => byId.has(relationship.startTableId) && byId.has(relationship.endTableId));
  const related = new Set(relationships.flatMap((relationship) => pairsOf(relationship).flatMap((pair) => [pair.startFieldId, pair.endFieldId])));
  const dialect: Dialect = schema.dialect === "postgres" ? "postgres" : "oracle";
  const ctx: LintContext = { tables: [...byId.values()], byId, relationships, related, postgres: dialect === "postgres" };
  return (RULES as readonly Rule[]).filter((rule) => !disabled.has(rule.id) && (!rule.dialects || rule.dialects.includes(dialect))).flatMap((rule) =>
    (rule.run(ctx) as Omit<LintFinding, "severity" | "ruleId" | "key">[]).map((finding) => ({
      ...finding,
      severity: "suggestion" as const,
      ruleId: rule.id as LintRuleId,
      key: [rule.id, finding.tableId, finding.columnId ?? "", finding.fix?.kind === "addIndex" ? finding.fix.columnIds.join("+") : ""].join(":"),
    })),
  );
}

const patchTable = (schema: Schema, tableId: string, mutate: (table: Table) => Table): Schema =>
  ({ ...schema, tables: schema.tables.map((table) => (table.id === tableId ? mutate(table) : table)) });
const patchColumn = (table: Table, columnId: string, patch: Partial<Column>): Table =>
  ({ ...table, columns: table.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column)) });

/**
 * `finding.fix` applied to `schema` -- or `schema` itself when the finding no
 * longer holds there *exactly*. The key names only the rule and the entities, so
 * the fix payload is compared too: a column renamed after the drawer rendered
 * still has a camelCase finding under the same key, but its rename target moved,
 * and applying the old one would overwrite the newer edit.
 */
export function applyLintFix(schema: Schema, finding: LintFinding): Schema {
  const { fix } = finding;
  const stale = JSON.stringify(fix);
  if (!fix || !lintSchema(schema).some((current) => current.key === finding.key && JSON.stringify(current.fix) === stale)) return schema;
  switch (fix.kind) {
    case "addIndex":
      return patchTable(schema, fix.tableId, (table) => ({ ...table, indexes: [...(table.indexes ?? []), makeIndex(fix.columnIds)] }));
    case "addPrimaryKey":
      return patchTable(schema, fix.tableId, (table) => {
        const id = table.columns.find((column) => normalizeIdentifier(column.name) === "ID");
        // A PostgreSQL diagram's key is a bigint identity (`NUMBER(19)`), as its new tables get.
        const postgres = schema.dialect === "postgres";
        return id
          ? patchColumn(table, id.id, { pk: true, notNull: true })
          : {
            ...table,
            ...(postgres ? { keyStrategy: "identity" as const } : {}),
            columns: [makeColumn({ name: "ID", type: "NUMBER", size: postgres ? "19" : "", notNull: true, pk: true }), ...table.columns],
          };
      });
    case "useIdentity":
      return patchTable(schema, fix.tableId, (table) => ({ ...patchColumn(table, fix.columnId, { postgresType: undefined }), keyStrategy: "identity" }));
    case "patchColumn":
      return patchTable(schema, fix.tableId, (table) => patchColumn(table, fix.columnId, fix.patch));
    case "renameTable":
      return patchTable(schema, fix.tableId, (table) => ({ ...table, name: fix.name }));
    case "renameColumn":
      return patchTable(schema, fix.tableId, (table) => patchColumn(table, fix.columnId, { name: fix.name }));
  }
}
