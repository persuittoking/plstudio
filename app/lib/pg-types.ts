import type { Column, OracleType } from "./schema";

/**
 * The type picker of a PostgreSQL diagram, and what each choice is stored as.
 *
 * Columns are always stored as Oracle types (see `app/lib/dialect.ts`). Most
 * PostgreSQL types have an Oracle twin and are told apart by it alone: `bigint`
 * is `NUMBER(19)`, `uuid` is `RAW(16)`. The rest -- `jsonb`, `boolean`, `inet`,
 * arrays -- have none, so they are `extra`: the column keeps the closest Oracle
 * type (so the Oracle DDL stays valid) and remembers the PostgreSQL one in
 * `Column.postgresType`, which only counts while `type` is still the Oracle
 * type that choice is stored as.
 */
export type PgTypeOption = {
  id: string;
  group: string;
  oracle: OracleType;
  /** A fixed size the choice always stores (`integer` is `NUMBER(10)`). */
  size?: string;
  /** The choice takes a size the user types; `placeholder` is the hint, `initial` what it starts at. */
  sized?: { placeholder: string; initial: string };
  /** No Oracle twin: remembered in `Column.postgresType`. */
  extra?: boolean;
};

/** The widths whole numbers are stored as: `NUMBER(5)` is smallint, and so on. */
export const PG_INTEGER_WIDTHS = { smallint: "5", integer: "10", bigint: "19" } as const;

const TEXT = "Text";
const NUMBERS = "Numbers";
const TIME = "Date and time";
const OTHER = "Boolean, binary, ids";
const JSON = "JSON and documents";
const NETWORK = "Network";
const SEARCH = "Full-text search";
const ARRAYS = "Arrays";
const RANGES = "Ranges";
const GEOMETRY = "Geometry";

export const PG_TYPE_OPTIONS: readonly PgTypeOption[] = [
  { id: "varchar", group: TEXT, oracle: "VARCHAR2", sized: { placeholder: "length", initial: "100" } },
  { id: "char", group: TEXT, oracle: "CHAR", sized: { placeholder: "length", initial: "1" } },
  { id: "text", group: TEXT, oracle: "CLOB" },
  { id: "bit", group: TEXT, oracle: "VARCHAR2", sized: { placeholder: "length", initial: "8" }, extra: true },
  { id: "bit varying", group: TEXT, oracle: "VARCHAR2", sized: { placeholder: "length", initial: "64" }, extra: true },

  { id: "smallint", group: NUMBERS, oracle: "NUMBER", size: PG_INTEGER_WIDTHS.smallint },
  { id: "integer", group: NUMBERS, oracle: "NUMBER", size: PG_INTEGER_WIDTHS.integer },
  { id: "bigint", group: NUMBERS, oracle: "NUMBER", size: PG_INTEGER_WIDTHS.bigint },
  { id: "numeric", group: NUMBERS, oracle: "NUMBER", sized: { placeholder: "precision[,scale]", initial: "" } },
  { id: "real", group: NUMBERS, oracle: "BINARY_FLOAT" },
  { id: "double precision", group: NUMBERS, oracle: "BINARY_DOUBLE" },
  { id: "smallserial", group: NUMBERS, oracle: "NUMBER", size: PG_INTEGER_WIDTHS.smallint, extra: true },
  { id: "serial", group: NUMBERS, oracle: "NUMBER", size: PG_INTEGER_WIDTHS.integer, extra: true },
  { id: "bigserial", group: NUMBERS, oracle: "NUMBER", size: PG_INTEGER_WIDTHS.bigint, extra: true },
  { id: "money", group: NUMBERS, oracle: "NUMBER", size: "19,2", extra: true },

  { id: "date", group: TIME, oracle: "DATE" },
  { id: "timestamp", group: TIME, oracle: "TIMESTAMP", sized: { placeholder: "precision 0–6", initial: "" } },
  { id: "timestamptz", group: TIME, oracle: "TIMESTAMP WITH TIME ZONE" },
  { id: "time", group: TIME, oracle: "INTERVAL DAY TO SECOND", extra: true },
  { id: "timetz", group: TIME, oracle: "TIMESTAMP WITH TIME ZONE", extra: true },
  { id: "interval", group: TIME, oracle: "INTERVAL DAY TO SECOND", extra: true },
  { id: "interval year to month", group: TIME, oracle: "INTERVAL YEAR TO MONTH" },
  { id: "interval day to second", group: TIME, oracle: "INTERVAL DAY TO SECOND" },

  { id: "boolean", group: OTHER, oracle: "CHAR", size: "1", extra: true },
  { id: "bytea", group: OTHER, oracle: "BLOB" },
  { id: "uuid", group: OTHER, oracle: "RAW", size: "16" },

  { id: "jsonb", group: JSON, oracle: "CLOB", extra: true },
  { id: "json", group: JSON, oracle: "CLOB", extra: true },
  { id: "xml", group: JSON, oracle: "CLOB", extra: true },

  { id: "inet", group: NETWORK, oracle: "VARCHAR2", size: "45", extra: true },
  { id: "cidr", group: NETWORK, oracle: "VARCHAR2", size: "43", extra: true },
  { id: "macaddr", group: NETWORK, oracle: "VARCHAR2", size: "17", extra: true },
  { id: "macaddr8", group: NETWORK, oracle: "VARCHAR2", size: "23", extra: true },

  { id: "tsvector", group: SEARCH, oracle: "CLOB", extra: true },
  { id: "tsquery", group: SEARCH, oracle: "CLOB", extra: true },

  { id: "text[]", group: ARRAYS, oracle: "CLOB", extra: true },
  { id: "varchar[]", group: ARRAYS, oracle: "CLOB", extra: true },
  { id: "integer[]", group: ARRAYS, oracle: "CLOB", extra: true },
  { id: "bigint[]", group: ARRAYS, oracle: "CLOB", extra: true },
  { id: "numeric[]", group: ARRAYS, oracle: "CLOB", extra: true },
  { id: "uuid[]", group: ARRAYS, oracle: "CLOB", extra: true },
  { id: "jsonb[]", group: ARRAYS, oracle: "CLOB", extra: true },

  { id: "int4range", group: RANGES, oracle: "VARCHAR2", size: "100", extra: true },
  { id: "int8range", group: RANGES, oracle: "VARCHAR2", size: "100", extra: true },
  { id: "numrange", group: RANGES, oracle: "VARCHAR2", size: "100", extra: true },
  { id: "daterange", group: RANGES, oracle: "VARCHAR2", size: "100", extra: true },
  { id: "tsrange", group: RANGES, oracle: "VARCHAR2", size: "100", extra: true },
  { id: "tstzrange", group: RANGES, oracle: "VARCHAR2", size: "100", extra: true },

  { id: "point", group: GEOMETRY, oracle: "VARCHAR2", size: "100", extra: true },
  { id: "line", group: GEOMETRY, oracle: "VARCHAR2", size: "200", extra: true },
  { id: "lseg", group: GEOMETRY, oracle: "VARCHAR2", size: "200", extra: true },
  { id: "box", group: GEOMETRY, oracle: "VARCHAR2", size: "200", extra: true },
  { id: "circle", group: GEOMETRY, oracle: "VARCHAR2", size: "200", extra: true },
  { id: "path", group: GEOMETRY, oracle: "CLOB", extra: true },
  { id: "polygon", group: GEOMETRY, oracle: "CLOB", extra: true },
];

export const PG_OPTIONS_BY_ID = new Map(PG_TYPE_OPTIONS.map((option) => [option.id, option]));

/** The extra (no-Oracle-twin) choice a column carries, if it still holds: its Oracle type must still be the one the choice is stored as. */
export function pgExtraOf(column: Pick<Column, "type" | "postgresType">): PgTypeOption | undefined {
  const option = column.postgresType ? PG_OPTIONS_BY_ID.get(column.postgresType) : undefined;
  return option?.extra && option.oracle === column.type ? option : undefined;
}

/** An extra choice written out: `jsonb`, `bit(8)`. */
export const extraName = (option: PgTypeOption, size: string) =>
  option.sized && size.trim() ? `${option.id}(${size.trim()})` : option.id;

/** A serial is an integer with a sequence behind it: where only the integer will do (a foreign key, an identity), this is it. */
export const plainInteger = (type: string) =>
  ({ smallserial: "smallint", serial: "integer", bigserial: "bigint" })[type] ?? type;
