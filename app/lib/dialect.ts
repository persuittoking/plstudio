import { nativePgType, pgType } from "./postgres";
import { pgExtraOf, PG_INTEGER_WIDTHS, PG_OPTIONS_BY_ID as OPTIONS_BY_ID, PG_TYPE_OPTIONS, type PgTypeOption } from "./pg-types";
import { typeString, typeUsesSize, ORACLE_TYPES, type Column, type Dialect, type OracleType, type Schema, type Table } from "./schema";

/**
 * A diagram's database. Columns are always stored as Oracle types -- that is
 * what validation, the DDL, DML, migration and every other generator read --
 * and a PostgreSQL diagram is the same model under PostgreSQL's names: its
 * cards say `bigint`, its type picker offers `uuid`, and picking one stores the
 * Oracle type that means it (`NUMBER(19)`, `RAW(16)`). So nothing else has to
 * know which database a diagram is for, and both exports stay available.
 */
export const dialectOf = (schema: Pick<Schema, "dialect"> | null | undefined): Dialect =>
  schema?.dialect === "postgres" ? "postgres" : "oracle";

export const DIALECT_NAMES: Record<Dialect, string> = { oracle: "Oracle", postgres: "PostgreSQL" };

export { PG_TYPE_OPTIONS, type PgTypeOption } from "./pg-types";

/** The type as the diagram's database writes it: `VARCHAR2(100)` in Oracle, `varchar(100)` in PostgreSQL. */
export const typeName = (column: Pick<Column, "type" | "size" | "postgresType">, dialect: Dialect) =>
  dialect === "postgres" ? nativePgType(column) : typeString(column as Column);

/** The picker entry a stored column is shown under: `numeric(12,2)` is `numeric`, `NUMBER(19)` is `bigint`. */
export function pgOptionOf(column: Pick<Column, "type" | "size" | "postgresType">): PgTypeOption {
  const extra = pgExtraOf(column);
  if (extra) return extra;
  const base = nativePgType(column).replace(/\(.*$/, "");
  // `nvarchar2` and the like read as their PostgreSQL twin; anything unnamed falls back to text.
  return OPTIONS_BY_ID.get(base) ?? OPTIONS_BY_ID.get("text")!;
}

/** The column change picking `id` makes: the Oracle type, and the size it needs. A size the user typed is kept when it still fits. */
export type TypePatch = Pick<Column, "type" | "size" | "postgresType">;

/**
 * The column change picking `id` makes: the Oracle type, the size it needs (a
 * size the user typed is kept when it still fits), and -- for a type with no
 * Oracle twin -- the PostgreSQL type remembered beside it. `postgresType` is
 * always present, `undefined` when not needed, so a merge clears an old one.
 */
export function pgTypePatch(id: string, column: Pick<Column, "type" | "size" | "postgresType">): TypePatch {
  const option = OPTIONS_BY_ID.get(id);
  if (!option) return { type: column.type, size: column.size, postgresType: column.postgresType };
  const postgresType = option.extra ? option.id : undefined;
  if (option.size !== undefined) return { type: option.oracle, size: option.size, postgresType };
  if (!option.sized) return { type: option.oracle, size: "", postgresType };
  const keep = pgOptionOf(column).id === option.id;
  return { type: option.oracle, size: keep ? column.size : option.sized.initial, postgresType };
}

/** Whether a stored column's size is the user's to type -- `varchar(…)` yes, `bigint` no. */
export const pgTakesSize = (column: Pick<Column, "type" | "size" | "postgresType">) => Boolean(pgOptionOf(column).sized);

/** The type picker's choices for a dialect, as `[id, label]`. */
export const typeChoices = (dialect: Dialect): readonly (readonly [string, string])[] =>
  dialect === "postgres" ? PG_TYPE_OPTIONS.map((option) => [option.id, option.id] as const) : ORACLE_TYPES.map((type) => [type, type] as const);

/** The same choices in labelled groups -- PostgreSQL's list is long; Oracle's is one unlabelled group. */
export function typeChoiceGroups(dialect: Dialect): { label: string; choices: (readonly [string, string])[] }[] {
  if (dialect !== "postgres") return [{ label: "", choices: [...typeChoices("oracle")] }];
  const groups = new Map<string, (readonly [string, string])[]>();
  PG_TYPE_OPTIONS.forEach((option) => groups.set(option.group, [...(groups.get(option.group) ?? []), [option.id, option.id] as const]));
  return [...groups].map(([label, choices]) => ({ label, choices }));
}

/** The picker entry a column sits under in a dialect. */
export const choiceOf = (column: Pick<Column, "type" | "size" | "postgresType">, dialect: Dialect) =>
  dialect === "postgres" ? pgOptionOf(column).id : column.type;

/** The change a picker choice makes in a dialect. */
export const choicePatch = (id: string, column: Pick<Column, "type" | "size" | "postgresType">, dialect: Dialect): TypePatch =>
  dialect === "postgres"
    ? pgTypePatch(id, column)
    // Picking an Oracle type is a deliberate choice of that type: a PostgreSQL-only one picked earlier no longer applies.
    : { type: id as OracleType, size: typeUsesSize(id as OracleType) ? column.size : "", postgresType: undefined };

/** Whether a choice takes a typed size. */
export const choiceTakesSize = (id: string, dialect: Dialect) =>
  dialect === "postgres" ? Boolean(OPTIONS_BY_ID.get(id)?.sized) : typeUsesSize(id as OracleType);

/** The typed size's hint for a choice. */
export const choicePlaceholder = (id: string, dialect: Dialect, oracleHint: (type: OracleType) => string) =>
  dialect === "postgres" ? OPTIONS_BY_ID.get(id)?.sized?.placeholder ?? "size" : oracleHint(id as OracleType);

/**
 * An Oracle column moved to what a PostgreSQL diagram stores for it, keeping
 * its meaning: `DATE` keeps the time of day, so it becomes `timestamp(0)`;
 * `NUMBER(9)` becomes `integer`; `NVARCHAR2` is `varchar`. A key column with
 * no precision becomes `bigint`, the type PostgreSQL gives an identity key.
 */
export function toPostgresColumn<C extends Pick<Column, "type" | "size" | "pk" | "postgresType">>(column: C): C {
  // Already a PostgreSQL-only type (`jsonb`): nothing to move.
  if (pgExtraOf(column)) return column;
  if (column.pk && column.type === "NUMBER" && !column.size.trim()) return { ...column, size: PG_INTEGER_WIDTHS.bigint };
  const target = pgType(column).type;
  const [, base, args = ""] = target.match(/^([a-z ]+?)(?:\((.*)\))?$/) ?? [];
  let patch: Pick<Column, "type" | "size">;
  if (base === "numeric") patch = { type: "NUMBER", size: args };
  else if (base === "timestamp") patch = { type: "TIMESTAMP", size: args };
  else if (base && OPTIONS_BY_ID.has(base)) patch = pgTypePatch(base, { type: column.type, size: args });
  else patch = { type: "CLOB", size: "" };
  // A sized option keeps the size the Oracle type had, which `pgTypePatch` only does for its own kind.
  if (base === "varchar" || base === "char") patch = { ...patch, size: args };
  return patch.type === column.type && patch.size === column.size ? column : { ...column, ...patch };
}

/**
 * A whole diagram moved to PostgreSQL: every column as above, and a key made
 * by sequence and trigger -- Oracle's way -- made an identity, PostgreSQL's.
 */
export function convertToPostgres(schema: Schema): Schema {
  const tables = schema.tables.map((table): Table => {
    const columns = table.columns.map((column) => toPostgresColumn(column));
    const keyStrategy = table.keyStrategy === "sequence-trigger" ? "identity" : table.keyStrategy;
    return columns.every((column, index) => column === table.columns[index]) && keyStrategy === table.keyStrategy
      ? table
      : { ...table, keyStrategy, columns };
  });
  // A foreign key's column follows its target, so a key column and its references keep matching types.
  const byId = new Map(tables.flatMap((table) => table.columns.map((column) => [column.id, column] as const)));
  const aligned = tables.map((table) => {
    const columns = table.columns.map((column) => {
      const target = column.fk ? byId.get(column.fk.columnId) : undefined;
      return target && target.type === column.type && target.size !== column.size ? { ...column, size: target.size } : column;
    });
    return columns.every((column, index) => column === table.columns[index]) ? table : { ...table, columns };
  });
  const columnTemplates = schema.columnTemplates?.map((template) => ({
    ...template,
    columns: template.columns.map((column) => toPostgresColumn(column)),
  }));
  return { ...schema, dialect: "postgres", tables: aligned, ...(columnTemplates ? { columnTemplates } : {}) };
}

/** Back to Oracle: the columns are Oracle types already, so only the label changes. */
export const convertToOracle = (schema: Schema): Schema => {
  const { dialect: _dialect, ...rest } = schema;
  return rest;
};
