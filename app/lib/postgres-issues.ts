import { generatePostgres, nativePgType } from "./postgres";
import { normalizeIdentifier, ORACLE_TYPES, type Column, type OracleType, type Schema } from "./schema";
import { validateSchema, type ValidationIssue } from "./validation";

/** Oracle's own limits, which a PostgreSQL script does not have: it quotes reserved words and shortens long names itself. */
const ORACLE_ONLY = /exceeds Oracle|reserved Oracle word/;

/** An Oracle type named in a message, as a PostgreSQL diagram calls it: `VARCHAR2` is `varchar`. */
const pgName = (type: string) => nativePgType({ type: type as OracleType, size: "" }).replace(/\(.*$/, "");
const TYPE_IN_MESSAGE = new RegExp(`\\b(${[...ORACLE_TYPES].sort((a, b) => b.length - a.length).map((type) => type.replace(/ /g, "\\s")).join("|")})\\b`);

/**
 * One of `validateSchema`'s messages, said for PostgreSQL: the same problem,
 * in PostgreSQL's words and type names. Unknown messages pass through as they are.
 */
function inPostgresTerms(issue: ValidationIssue, columns: Map<string, Column>): ValidationIssue {
  const column = issue.columnId ? columns.get(issue.columnId) : undefined;
  const say = (message: string) => ({ ...issue, message });
  const [, prefix = "", rest = issue.message] = issue.message.match(/^([^:]+: )?(.*)$/) ?? [];
  if (/Check expression is not a supported single Oracle expression/.test(rest))
    return say(`${prefix}CHECK must be one PostgreSQL condition, such as STATUS IN ('A', 'B'): with matching quotes and no ';' or other statements.`);
  if (/collides with .* after Oracle normalization/.test(rest))
    return say(issue.message.replace(/ after Oracle normalization\./, ": PostgreSQL lowercases unquoted names, so both are the same name."));
  if (/generated key strategy requires exactly one numeric PK/.test(rest))
    return say(`${prefix}an identity key needs exactly one integer primary key column (smallint, integer or bigint); otherwise set Key to None.`);
  if (/composite-PK targets require FK groups/.test(rest) && column) {
    const target = column.fk ? [...columns.values()].find((item) => item.id === column.fk!.columnId) : undefined;
    return say(`${prefix}points at ${target ? target.name : "a column"} of a table whose primary key has several columns; PostgreSQL needs a foreign key to cover the whole key — add the other key columns to the relationship, or give the target a single-column key.`);
  }
  if (/^NUMBER precision must be 1–38/.test(rest))
    return say(`${prefix}numeric precision must be 1–38, with an optional scale, such as 12,2.`);
  if (/^NUMBER scale must be/.test(rest))
    return say(`${prefix}numeric scale must be between -84 and 127.`);
  if (/^FK type must match/.test(rest) && column) {
    const target = rest.match(/match (.+)\.$/)?.[1] ?? "its target";
    const targetColumn = column.fk ? columns.get(column.fk.columnId) : undefined;
    return say(`${prefix}a foreign key column must have the same type as the column it points at: this is ${nativePgType(column)}, ${target} is ${targetColumn ? nativePgType(targetColumn) : "different"}.`);
  }
  // "VARCHAR2 requires a size", "RAW size must be…": the same rule, under the PostgreSQL name.
  const type = rest.match(TYPE_IN_MESSAGE)?.[1];
  return type ? say(`${prefix}${rest.replace(type, pgName(type.replace(/\s+/g, " ")))}`) : issue;
}

/** What PostgreSQL itself is stricter about than Oracle. */
function postgresLimits(schema: Schema): ValidationIssue[] {
  return schema.tables.flatMap((table) => table.columns
    .filter((column) => column.type === "TIMESTAMP" && /^\d+$/.test(column.size.trim()) && Number(column.size) > 6)
    .map((column) => ({
      severity: "error" as const,
      message: `${table.name}.${column.name}: timestamp precision must be 0–6 in PostgreSQL (fractions of a second up to microseconds).`,
      tableId: table.id,
      columnId: column.id,
    })));
}

/**
 * The Issues drawer of a PostgreSQL diagram: the diagram's own problems (an
 * empty name, a broken reference, a bad CHECK) in PostgreSQL's words and
 * without Oracle's limits, what PostgreSQL is stricter about, and then what it
 * would refuse or read differently, each with its fix -- the same warnings the
 * PostgreSQL tab of Export lists.
 */
export function postgresIssues(schema: Schema): ValidationIssue[] {
  const columns = new Map(schema.tables.flatMap((table) => table.columns.map((column) => [column.id, column] as const)));
  const own = validateSchema(schema)
    .filter((issue) => !ORACLE_ONLY.test(issue.message))
    .map((issue) => inPostgresTerms(issue, columns));
  const tableIds = new Map(schema.tables.map((table) => [normalizeIdentifier(table.name).toLowerCase(), table.id]));
  const postgres = generatePostgres(schema).notes
    .filter((note) => note.level === "warning")
    .map((note): ValidationIssue => ({
      severity: "warning",
      message: `PostgreSQL — ${note.table ? `${note.table.toUpperCase()}: ` : ""}${note.message}`,
      tableId: note.table ? tableIds.get(note.table.replace(/"/g, "").toLowerCase()) : undefined,
    }));
  return [...own, ...postgresLimits(schema), ...postgres];
}
