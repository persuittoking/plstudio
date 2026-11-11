import { appendCreateTable, parseCreateTable, type AppendResult, type ParseOptions, type ParseResult } from "./parser";
import { PG_INTEGER_WIDTHS, PG_OPTIONS_BY_ID } from "./pg-types";
import { normalizeIdentifier, type Schema } from "./schema";

/**
 * Importing a PostgreSQL script.
 *
 * The importer proper (`parseCreateTable`) reads Oracle's CREATE TABLE, and a
 * diagram stores Oracle types whatever its database (`app/lib/dialect.ts`), so
 * a PostgreSQL script is first translated: every column's PostgreSQL type
 * becomes the Oracle type a PostgreSQL diagram stores it as (`bigint` is
 * `NUMBER(19)`, `uuid` is `RAW(16)`), and PostgreSQL's own syntax that Oracle's
 * reader does not know (`IF NOT EXISTS`, `::` casts, `USING btree`,
 * `ALTER TABLE ONLY`, enum types) is rewritten or set aside. Types with no
 * Oracle twin (`jsonb`, `boolean`, `serial`, `inet`…) are remembered and put
 * back on the parsed columns as `postgresType`, so the diagram shows them as
 * written and the PostgreSQL script writes them back.
 */

/** What a PostgreSQL type is stored as: the Oracle type and size, and the PostgreSQL-only type, if any. */
type Mapped = { oracle: string; postgresType?: string; check?: string; note?: string };

const extra = (id: string, size?: string): Mapped => {
  const option = PG_OPTIONS_BY_ID.get(id)!;
  const width = size ?? option.size ?? "";
  return { oracle: width ? `${option.oracle}(${width})` : option.oracle, postgresType: id };
};

/** A quoted literal list, for an enum column's CHECK. */
const quoted = (values: string[]) => values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");

/**
 * The type at the start of `text` (a column definition after its name), and
 * how much of `text` it took. Unknown types are read as text and reported.
 */
function mapType(text: string, enums: Map<string, string[]>, column: string): Mapped & { length: number } {
  const take = (pattern: RegExp) => text.match(pattern);
  const array = (length: number, base: string): Mapped & { length: number } | null => {
    const rest = text.slice(length).match(/^\s*(?:\[\s*\d*\s*\])+|^\s+ARRAY\b(?:\s*\[\s*\d*\s*\])?/i);
    if (!rest) return null;
    const id = `${base}[]`;
    return PG_OPTIONS_BY_ID.has(id)
      ? { ...extra(id), length: length + rest[0].length }
      : { oracle: "CLOB", length: length + rest[0].length, note: `${column}: ${base}[] has no array type here; imported as text.` };
  };
  const done = (match: RegExpMatchArray, mapped: Mapped, base?: string) => array(match[0].length, base ?? "") ?? { ...mapped, length: match[0].length };

  let m: RegExpMatchArray | null;
  if ((m = take(/^(?:character\s+varying|varchar)\s*(?:\(\s*(\d+)\s*\))?/i))) return done(m, { oracle: m[1] ? `VARCHAR2(${m[1]})` : "VARCHAR2" }, "varchar");
  if ((m = take(/^(?:character|char|bpchar)\b\s*(?:\(\s*(\d+)\s*\))?/i))) return done(m, { oracle: `CHAR(${m[1] ?? "1"})` });
  if ((m = take(/^(?:text|citext)\b/i))) return done(m, { oracle: "CLOB" }, "text");
  if ((m = take(/^(?:smallserial|serial2)\b/i))) return done(m, extra("smallserial"));
  if ((m = take(/^(?:bigserial|serial8)\b/i))) return done(m, extra("bigserial"));
  if ((m = take(/^(?:serial|serial4)\b/i))) return done(m, extra("serial"));
  if ((m = take(/^(?:smallint|int2)\b/i))) return done(m, { oracle: `NUMBER(${PG_INTEGER_WIDTHS.smallint})` });
  if ((m = take(/^(?:bigint|int8)\b/i))) return done(m, { oracle: `NUMBER(${PG_INTEGER_WIDTHS.bigint})` }, "bigint");
  if ((m = take(/^(?:integer|int4|int)\b/i))) return done(m, { oracle: `NUMBER(${PG_INTEGER_WIDTHS.integer})` }, "integer");
  if ((m = take(/^(?:numeric|decimal)\b\s*(?:\(\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\))?/i)))
    return done(m, { oracle: m[1] ? `NUMBER(${m[1]}${m[2] ? `,${m[2]}` : ""})` : "NUMBER" }, "numeric");
  if ((m = take(/^(?:real|float4)\b/i))) return done(m, { oracle: "BINARY_FLOAT" });
  if ((m = take(/^(?:double\s+precision|float8)\b/i))) return done(m, { oracle: "BINARY_DOUBLE" });
  if ((m = take(/^float\b\s*(?:\(\s*(\d+)\s*\))?/i))) return done(m, { oracle: m[1] && Number(m[1]) <= 24 ? "BINARY_FLOAT" : "BINARY_DOUBLE" });
  if ((m = take(/^money\b/i))) return done(m, extra("money"));
  if ((m = take(/^(?:boolean|bool)\b/i))) return done(m, extra("boolean"));
  if ((m = take(/^(?:timestamptz|timestamp\s*(?:\(\s*(\d+)\s*\))?\s+with\s+time\s+zone)/i))) return done(m, { oracle: "TIMESTAMP WITH TIME ZONE" });
  if ((m = take(/^timestamp\b\s*(?:\(\s*(\d+)\s*\))?(?:\s+without\s+time\s+zone)?/i))) return done(m, { oracle: m[1] ? `TIMESTAMP(${m[1]})` : "TIMESTAMP" });
  if ((m = take(/^(?:timetz|time\s*(?:\(\s*\d+\s*\))?\s+with\s+time\s+zone)/i))) return done(m, extra("timetz"));
  if ((m = take(/^time\b\s*(?:\(\s*\d+\s*\))?(?:\s+without\s+time\s+zone)?/i))) return done(m, extra("time"));
  if ((m = take(/^date\b/i))) return done(m, { oracle: "DATE" });
  if ((m = take(/^interval\s+year(?:\s+to\s+month)?/i))) return done(m, { oracle: "INTERVAL YEAR TO MONTH" });
  if ((m = take(/^interval\s+day\s+to\s+second(?:\s*\(\s*\d+\s*\))?/i))) return done(m, { oracle: "INTERVAL DAY TO SECOND" });
  if ((m = take(/^interval\b(?:\s+(?:day|hour|minute|second)(?:\s+to\s+(?:hour|minute|second))?)?(?:\s*\(\s*\d+\s*\))?/i))) return done(m, extra("interval"));
  if ((m = take(/^bytea\b/i))) return done(m, { oracle: "BLOB" });
  if ((m = take(/^uuid\b/i))) return done(m, { oracle: "RAW(16)" }, "uuid");
  if ((m = take(/^(?:bit\s+varying|varbit)\b\s*(?:\(\s*(\d+)\s*\))?/i))) return done(m, extra("bit varying", m[1] ?? "64"));
  if ((m = take(/^bit\b\s*(?:\(\s*(\d+)\s*\))?/i))) return done(m, extra("bit", m[1] ?? "1"));
  // The rest of PostgreSQL's own types, by the names the picker knows them by.
  // A schema-qualified name (`public.order_status`) is the type of that name.
  const word = take(/^(?:"?[a-z_][\w$]*"?\s*\.\s*)?"?([a-z_][\w$]*)"?/i);
  if (word) {
    const id = word[1].toLowerCase();
    if (PG_OPTIONS_BY_ID.get(id)?.extra) return done(word, extra(id), id);
    const values = enums.get(id);
    if (values) {
      // An enum is stored as text with its values as a CHECK -- the shape the PostgreSQL export turns back into an enum.
      const width = Math.max(1, ...values.map((value) => value.length));
      return { ...(array(word[0].length, "") ?? { length: word[0].length }), oracle: width === 1 ? "CHAR(1)" : `VARCHAR2(${width})`, check: `${column} IN (${quoted(values)})` };
    }
  }
  const unknown = text.match(/^[^\s,(]+(?:\s*\([^)]*\))?/)?.[0] ?? "";
  return { oracle: "CLOB", length: unknown.length, note: `${column}: type ${unknown || "?"} is not known here; imported as text.` };
}

/** Removes `--` and `/* *\/` comments, leaving quoted text alone. */
function stripComments(sql: string) {
  return sql.replace(/'(?:''|[^'])*'|"(?:[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (token) => (token.startsWith("'") || token.startsWith('"') ? token : " "));
}

/** `'A'::character varying` → `'A'`, `now()::date` → `now()`: Oracle's reader has no casts, and a default reads the same without. */
const dropCasts = (text: string) => text.replace(/::\s*(?:"[^"]+"|[a-z_][\w]*(?:\s+(?:varying|precision|without\s+time\s+zone|with\s+time\s+zone))?)(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?/gi, "");

/** Index of the `)` closing the `(` at `open`, quote-aware. */
function closing(text: string, open: number) {
  let depth = 0;
  let quote = false;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") quote = !quote;
    if (quote) continue;
    if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Top-level comma-separated parts of a CREATE TABLE body. */
function parts(body: string) {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "'") quote = !quote;
    if (quote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}

const IDENT = `(?:"[^"]+"|[A-Za-z_][\\w$]*)`;
const NAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;
const bare = (name: string) => {
  const last = name.match(/"[^"]+"|[A-Za-z_][\w$]*/g)?.pop() ?? name;
  return last.startsWith('"') ? last.slice(1, -1) : last;
};
const key = (table: string, column: string) => `${normalizeIdentifier(bare(table))}.${normalizeIdentifier(bare(column))}`;

export type PostgresTranslation = {
  /** The script as Oracle's CREATE TABLE reader understands it. */
  sql: string;
  /** `TABLE.COLUMN` (normalized) → its PostgreSQL-only type. */
  postgresTypes: Map<string, string>;
  /** Tables whose key PostgreSQL makes itself (identity). */
  identity: Set<string>;
  warnings: string[];
};

/** A PostgreSQL script rewritten for the Oracle CREATE TABLE reader; see the file comment. */
export function translatePostgres(input: string): PostgresTranslation {
  const warnings: string[] = [];
  const postgresTypes = new Map<string, string>();
  const identity = new Set<string>();
  let sql = stripComments(input);

  // Enum types first: a column may be declared with one before or after it.
  const enums = new Map<string, string[]>();
  sql = sql.replace(new RegExp(`CREATE\\s+TYPE\\s+(${NAME})\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)\\s*;?`, "gi"), (_all, name: string, list: string) => {
    enums.set(bare(name).toLowerCase(), [...list.matchAll(/'((?:''|[^'])*)'/g)].map((value) => value[1].replace(/''/g, "'")));
    return "";
  });

  // PostgreSQL wording around the statements Oracle's reader knows.
  sql = sql
    .replace(/CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP|TEMPORARY|UNLOGGED)\s+TABLE/gi, "CREATE TABLE")
    .replace(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/gi, "CREATE TABLE")
    .replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?/gi, (_all, unique: string | undefined) => `CREATE ${unique ?? ""}INDEX `)
    .replace(new RegExp(`(\\bON\\s+(?:ONLY\\s+)?)(${NAME})\\s+USING\\s+\\w+\\s*\\(`, "gi"), "$1$2 (")
    .replace(/\bON\s+ONLY\s+/gi, "ON ")
    .replace(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/gi, "ALTER TABLE ");

  // pg_dump writes an identity key as its own statement.
  sql.replace(new RegExp(`ALTER\\s+TABLE\\s+(${NAME})\\s+ALTER\\s+(?:COLUMN\\s+)?(${IDENT})\\s+ADD\\s+GENERATED\\s+(?:ALWAYS|BY\\s+DEFAULT)\\s+AS\\s+IDENTITY`, "gi"), (all, table: string) => {
    identity.add(normalizeIdentifier(bare(table)));
    return all;
  });

  // Each CREATE TABLE body: its columns' types rewritten one by one.
  const head = new RegExp(`CREATE\\s+TABLE\\s+(${NAME})\\s*\\(`, "gi");
  let out = "";
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = head.exec(sql))) {
    const open = match.index + match[0].length - 1;
    const close = closing(sql, open);
    if (close < 0) break;
    const table = match[1];
    const lines = parts(sql.slice(open + 1, close)).map((line) => {
      if (/^(?:CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|FOREIGN\s+KEY\b|CHECK\b|EXCLUDE\b|LIKE\b)/i.test(line)) {
        if (/^(?:EXCLUDE|LIKE)\b/i.test(line)) { warnings.push(`${bare(table)}: skipped ${line.split(/\s/)[0].toUpperCase()} clause.`); return ""; }
        return dropCasts(line);
      }
      const column = line.match(new RegExp(`^(${IDENT})\\s+([\\s\\S]*)$`));
      if (!column) return line;
      const mapped = mapType(column[2], enums, bare(column[1]));
      if (mapped.note) warnings.push(`${bare(table)}.${mapped.note}`);
      if (mapped.postgresType) postgresTypes.set(key(table, column[1]), mapped.postgresType);
      if (/\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(column[2])) identity.add(normalizeIdentifier(bare(table)));
      const rest = dropCasts(column[2].slice(mapped.length))
        .replace(/\bCOLLATE\s+(?:"[^"]+"|\S+)/gi, "")
        // Identity options in brackets mean nothing to the model.
        .replace(/(\bAS\s+IDENTITY)\s*\([^)]*\)/gi, "$1")
        // PostgreSQL's NOT DEFERRABLE / ON UPDATE tails, which Oracle's reader does not expect after a reference.
        .replace(/\s+ON\s+UPDATE\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)/gi, "")
        .replace(/\s+ON\s+DELETE\s+(?:RESTRICT|NO\s+ACTION|SET\s+DEFAULT)/gi, "");
      const check = mapped.check && !/\bCHECK\s*\(/i.test(rest) ? ` CHECK (${mapped.check})` : "";
      return `${column[1]} ${mapped.oracle}${rest ? ` ${rest.trim()}` : ""}${check}`;
    }).filter(Boolean);
    out += sql.slice(from, open + 1) + "\n  " + lines.join(",\n  ") + "\n)";
    from = close + 1;
    head.lastIndex = close + 1;
  }
  out += sql.slice(from);
  // Table-level and ALTER TABLE tails Oracle's reader does not expect.
  out = out
    .replace(/\s+ON\s+UPDATE\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)/gi, "")
    .replace(/\s+ON\s+DELETE\s+(?:RESTRICT|NO\s+ACTION|SET\s+DEFAULT)/gi, "")
    .replace(/\s+NOT\s+VALID\b/gi, "");
  return { sql: out, postgresTypes, identity, warnings };
}

/** Lowercase names, as PostgreSQL scripts usually write them, take the diagram's upper case; quoted mixed case stays. */
const tidy = (name: string) => (name === name.toLowerCase() ? name.toUpperCase() : name);

/** The parsed schema as a PostgreSQL diagram: the PostgreSQL-only types back on their columns, names in the diagram's case, keys as PostgreSQL makes them. */
function asPostgresDiagram(schema: Schema, translation: PostgresTranslation): Schema {
  const tables = schema.tables.map((table) => {
    const tableKey = normalizeIdentifier(table.name);
    const columns = table.columns.map((column) => {
      const postgresType = translation.postgresTypes.get(`${tableKey}.${normalizeIdentifier(column.name)}`);
      return { ...column, name: tidy(column.name), ...(postgresType ? { postgresType } : {}) };
    });
    const keys = columns.filter((column) => column.pk);
    // PostgreSQL has no sequence-and-trigger keys: a key is an identity, a serial (which brings its own sequence), or the application's.
    const keyStrategy = keys.length === 1 && translation.identity.has(tableKey) ? "identity" as const : "none" as const;
    return {
      ...table,
      name: tidy(table.name),
      keyStrategy,
      columns,
      indexes: table.indexes?.map((index) => ({ ...index, name: index.name ? tidy(index.name) : index.name })),
      uniques: table.uniques?.map((unique) => ({ ...unique, name: unique.name ? tidy(unique.name) : unique.name })),
    };
  });
  return {
    ...schema,
    name: schema.name === "Imported Oracle Schema" ? "Imported PostgreSQL Schema" : schema.name,
    dialect: "postgres",
    tables,
    relationships: schema.relationships?.map((relationship) => ({ ...relationship, name: relationship.name ? tidy(relationship.name) : relationship.name })),
  };
}

/** A PostgreSQL script as a new PostgreSQL diagram. */
export function parsePostgres(sql: string, options: ParseOptions = {}): ParseResult {
  const translation = translatePostgres(sql);
  const parsed = parseCreateTable(translation.sql, options);
  const warnings = [...translation.warnings, ...parsed.warnings];
  if (!parsed.schema) return { ...parsed, warnings, errors: parsed.errors.map((error) => error.replace("No supported CREATE TABLE statements found.", "No CREATE TABLE statements found in the PostgreSQL script.")) };
  return { schema: asPostgresDiagram(parsed.schema, translation), warnings, errors: [] };
}

/** A PostgreSQL script's tables added to `base`, exactly as `appendCreateTable` adds an Oracle script's. */
export function appendPostgres(base: Schema, sql: string): AppendResult {
  return appendCreateTable(base, sql, parsePostgres);
}

/** A rough guess whether a script is PostgreSQL rather than Oracle, for choosing the tab a file opens on. */
export function looksLikePostgres(sql: string) {
  return /\b(?:serial|bigserial|smallserial|jsonb?|boolean|bytea|timestamptz|uuid|text\[\]|character\s+varying|double\s+precision|USING\s+btree|CREATE\s+TYPE\s+\S+\s+AS\s+ENUM|IF\s+NOT\s+EXISTS)\b|::/i.test(sql)
    && !/\b(?:VARCHAR2|NUMBER\s*\(|CLOB|NVARCHAR2|BINARY_DOUBLE)\b/i.test(sql);
}

