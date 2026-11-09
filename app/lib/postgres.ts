import { ddlModel, type DDLConstraint, type DDLTable } from "./generators";
import { extraName, pgExtraOf, PG_INTEGER_WIDTHS, plainInteger } from "./pg-types";
import { normalizeIdentifier, normalizeRelationships, primaryKeyColumns, type Column, type RelationshipConstraint, type Schema, type Table } from "./schema";

/**
 * The diagram as PostgreSQL DDL. It is built on `ddlModel`, the same resolved
 * model the Oracle DDL prints, so tables, columns and constraints carry the
 * same names in both; only what Oracle and PostgreSQL write differently is
 * translated here -- types, keys, default and CHECK expressions, foreign-key
 * rules -- and every translation a reader should know about becomes a note.
 */

export type PostgresOptions = {
  /** `""` or `public` writes no schema statements. */
  schemaName: string;
  transaction: boolean;
  dropExisting: boolean;
  comments: boolean;
  /** PostgreSQL does not index foreign-key columns by itself; joins and cascades need one. */
  indexForeignKeys: boolean;
};

export const DEFAULT_POSTGRES_OPTIONS: PostgresOptions = {
  schemaName: "public", transaction: false, dropExisting: false, comments: true, indexForeignKeys: true,
};

export type PostgresNote = { level: "warning" | "info"; table?: string; message: string };
export type PostgresMapping = { oracle: string; postgres: string; count: number };
export type PostgresResult = {
  sql: string;
  notes: PostgresNote[];
  /** The types this diagram uses, and what each became. */
  mappings: PostgresMapping[];
  /** Where each table's section starts, counted from 0, for jumping to it. */
  tables: { name: string; line: number }[];
  stats: { tables: number; columns: number; foreignKeys: number; indexes: number };
};

/** Words PostgreSQL reserves: an identifier spelt like one has to be quoted. */
const RESERVED = new Set(
  ("all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate column concurrently constraint create cross " +
    "current_catalog current_date current_role current_schema current_time current_timestamp current_user default deferrable desc distinct do else end " +
    "except false fetch for foreign freeze from full grant group having ilike in initially inner intersect into is isnull join lateral leading left like " +
    "limit localtime localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references returning right select " +
    "session_user similar some symmetric table tablesample then to trailing true union unique user using variadic verbose when where window with").split(" "),
);
const NAME_LIMIT = 63;

/** Whether PostgreSQL reserves a name (case ignored), so a script must quote it everywhere. */
export const isPgReserved = (name: string) => RESERVED.has(name.trim().toLowerCase());
/** PostgreSQL's identifier limit, in bytes: longer names are cut. */
export const PG_NAME_LIMIT = NAME_LIMIT;

/** A name as PostgreSQL reads it: plain when it can be, quoted when it must be. */
export function pgIdentifier(name: string) {
  return /^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export { PG_INTEGER_WIDTHS } from "./pg-types";

/** A column of a PostgreSQL diagram by its PostgreSQL name: what its cards, picker and script all show. */
export function nativePgType(column: Pick<Column, "type" | "size" | "postgresType">): string {
  const extra = pgExtraOf(column);
  if (extra) return extraName(extra, column.size);
  const size = column.size.replace(/\s*(byte|char)\s*$/i, "").replace(/\s+/g, "").trim();
  switch (column.type) {
    case "VARCHAR2": case "NVARCHAR2": return size ? `varchar(${size})` : "varchar";
    case "CHAR": case "NCHAR": return size ? `char(${size})` : "char";
    case "NUMBER": {
      if (!size) return "numeric";
      const [precision, scale] = size.split(",");
      if (scale && Number(scale) > 0) return `numeric(${precision},${scale})`;
      const integer = Object.entries(PG_INTEGER_WIDTHS).find(([, width]) => width === precision)?.[0];
      return integer ?? `numeric(${precision})`;
    }
    case "DATE": return "date";
    case "TIMESTAMP WITH TIME ZONE": case "TIMESTAMP WITH LOCAL TIME ZONE": return "timestamptz";
    case "BFILE": return "text";
    default: return pgType(column).type;
  }
}

/** Integer types by the digits they hold, for `NUMBER(p)`. */
const integerFor = (precision: number) => (precision <= 4 ? "smallint" : precision <= 9 ? "integer" : precision <= 18 ? "bigint" : `numeric(${precision})`);

/**
 * The PostgreSQL type for an Oracle column, and why, when the choice is not
 * obvious. `native` reads the column as a PostgreSQL diagram stores it (see
 * `app/lib/dialect.ts`): its `date` is a date, and its whole numbers are the
 * exact widths its type picker writes, so the script says what the designer shows.
 */
export function pgType(column: Pick<Column, "type" | "size" | "postgresType">, native = false): { type: string; note?: string } {
  // A type picked in a PostgreSQL diagram with no Oracle twin (jsonb, boolean…) is written as picked, in either kind of diagram.
  const extra = pgExtraOf(column);
  if (extra) return { type: extraName(extra, column.size) };
  if (native) return { type: nativePgType(column) };
  const size = column.size.replace(/\s*(byte|char)\s*$/i, "").trim();
  const [precision, scale] = size.split(",").map((part) => Number(part.trim()));
  switch (column.type) {
    case "VARCHAR2": case "NVARCHAR2": return { type: size ? `varchar(${size})` : "text" };
    case "CHAR": case "NCHAR": return { type: size ? `char(${size})` : "char(1)" };
    case "NUMBER":
      if (!size) return { type: "numeric" };
      if (scale > 0) return { type: `numeric(${precision},${scale})` };
      return { type: integerFor(precision) };
    case "FLOAT": return { type: precision && precision <= 24 ? "real" : "double precision" };
    case "BINARY_FLOAT": return { type: "real" };
    case "BINARY_DOUBLE": return { type: "double precision" };
    case "DATE": return { type: "timestamp(0)", note: "Oracle DATE also keeps the time of day, so it becomes timestamp(0); use date if the time is never stored." };
    case "TIMESTAMP": return { type: size ? `timestamp(${size})` : "timestamp" };
    case "TIMESTAMP WITH TIME ZONE": return { type: size ? `timestamptz(${size})` : "timestamptz" };
    case "TIMESTAMP WITH LOCAL TIME ZONE": return { type: "timestamptz", note: "PostgreSQL has no local-time-zone timestamp; timestamptz stores the instant and shows it in the session's zone, which is the same idea." };
    case "INTERVAL YEAR TO MONTH": return { type: "interval year to month" };
    case "INTERVAL DAY TO SECOND": return { type: "interval day to second" };
    case "CLOB": case "NCLOB": return { type: "text" };
    case "BLOB": return { type: "bytea" };
    case "BFILE": return { type: "text", note: "BFILE points at a file outside the database; PostgreSQL has no such type, so the path is kept as text." };
    case "RAW": return size === "16"
      ? { type: "uuid", note: "RAW(16) usually holds a GUID, so it becomes uuid; use bytea if it holds other bytes." }
      : { type: "bytea" };
    default: return { type: "text" };
  }
}

/**
 * An Oracle default or CHECK expression in PostgreSQL's words. String literals
 * are left alone; only the code between them is rewritten.
 */
export function pgExpression(expression: string): { sql: string; notes: string[] } {
  const notes = new Set<string>();
  const sql = expression.split(/('(?:[^']|'')*')/).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/\btrunc\s*\(\s*sysdate\s*\)/gi, () => "current_date")
      .replace(/\bsysdate\b/gi, () => "localtimestamp(0)")
      .replace(/\bsystimestamp\b/gi, () => "current_timestamp")
      .replace(/\bsys_guid\s*\(\s*\)/gi, () => { notes.add("SYS_GUID() became gen_random_uuid(), which returns a uuid (PostgreSQL 13+)."); return "gen_random_uuid()"; })
      .replace(/\bnvl\s*\(/gi, () => "coalesce(")
      .replace(/\bnvl2\s*\(/gi, () => { notes.add("NVL2 has no PostgreSQL twin: rewrite it as CASE WHEN x IS NOT NULL THEN a ELSE b END."); return "nvl2("; })
      .replace(/\bdecode\s*\(/gi, () => { notes.add("DECODE has no PostgreSQL twin: rewrite it as a CASE expression."); return "decode("; })
      .replace(/\binstr\s*\(/gi, () => { notes.add("INSTR has no PostgreSQL twin: use strpos(text, part)."); return "instr("; })
      .replace(/\buser\b/gi, () => "current_user")
      .replace(/\brownum\b/gi, () => { notes.add("ROWNUM does not exist in PostgreSQL: use LIMIT, or row_number() over (…) in a query."); return "rownum"; })
      // Oracle's quoted names are upper-case; the tables here are written in lower case.
      .replace(/"([^"]+)"/g, (_, name: string) => pgIdentifier(name.toLowerCase()));
  }).join("");
  if (/^\s*''\s*$/.test(expression)) notes.add("Oracle reads '' as NULL; PostgreSQL keeps it as an empty string.");
  return { sql, notes: [...notes] };
}

/**
 * A code column whose CHECK allows a fixed list -- STATUS IN ('A', 'I', 'P'),
 * or a yes/no flag IN ('Y', 'N'), which Oracle keeps in CHAR(1) for want of a
 * boolean -- becomes a PostgreSQL enum of those values. Only the type changes:
 * the values, and the defaults, stay what they were.
 */
export type ColumnFlag = { kind: "enum"; values: string[] };

/** The values of a `column IN (...)` CHECK, or null when the CHECK says anything else. */
export function checkValues(check: string, column: string): { values: string[]; quoted: boolean } | null {
  const match = check.trim().match(/^\(?\s*"?([A-Za-z_][\w$#]*)"?\s+in\s*\(([^)]*)\)\s*\)?$/i);
  if (!match || match[1].toLowerCase() !== column.toLowerCase()) return null;
  const items = match[2].split(",").map((item) => item.trim());
  const quoted = items.every((item) => /^'(?:[^']|'')*'$/.test(item));
  if (!quoted && !items.every((item) => /^-?\d+$/.test(item))) return null;
  return { values: items.map((item) => (quoted ? item.slice(1, -1).replace(/''/g, "'") : item)), quoted };
}

export function columnFlag(column: Pick<Column, "name" | "type" | "check">): ColumnFlag | null {
  if (!["CHAR", "NCHAR", "VARCHAR2", "NVARCHAR2"].includes(column.type) || !column.check.trim()) return null;
  const found = checkValues(column.check, column.name);
  if (!found?.quoted || found.values.length < 2 || new Set(found.values).size !== found.values.length) return null;
  return { kind: "enum", values: found.values };
}

const RULE: Record<RelationshipConstraint, string> = {
  "No action": "", Restrict: "restrict", Cascade: "cascade", "Set null": "set null", "Set default": "set default",
};

/** Names over 63 bytes are cut by PostgreSQL itself; shortened here instead, with a hash, once each, so two never collide. */
function fitter(notes: PostgresNote[]) {
  const used = new Set<string>();
  const done = new Map<string, string>();
  const encoder = new TextEncoder();
  return (name: string, scope = "") => {
    const key = `${scope}\u0000${name}`;
    const known = done.get(key);
    if (known) return known;
    let fitted = name;
    if (encoder.encode(name).length > NAME_LIMIT) {
      const hash = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 46656, 7).toString(36).padStart(3, "0");
      fitted = `${name.slice(0, NAME_LIMIT - 4)}_${hash}`;
      for (let n = 2; used.has(fitted); n++) fitted = `${name.slice(0, NAME_LIMIT - 4 - String(n).length)}${n}_${hash}`;
      notes.push({ level: "info", table: scope || undefined, message: `${name} is longer than PostgreSQL's 63 characters, so it is written ${fitted}.` });
    }
    used.add(fitted);
    done.set(key, fitted);
    return fitted;
  };
}

export function generatePostgres(schema: Schema, options: PostgresOptions = DEFAULT_POSTGRES_OPTIONS): PostgresResult {
  const notes: PostgresNote[] = [];
  const fit = fitter(notes);
  const model = ddlModel(schema);
  const canonical = normalizeRelationships(schema);
  const tablesById = new Map(canonical.tables.map((table) => [table.id, table]));
  const relationships = new Map((canonical.relationships ?? []).map((relationship) => [relationship.id, relationship]));
  const names = new Map(model.map((table) => [table.id, pgIdentifier(fit(table.name))]));
  /*
   * A table in a schema group goes where the Oracle DDL puts it: its rows in
   * `<keyword>_data`, its keys and indexes in `<keyword>_index`. PostgreSQL has
   * the same clauses, and as in Oracle the tablespaces must exist first.
   */
  const tablespaceOf = (clause: string) => {
    const name = clause.match(/tablespace\s+(\S+)/)?.[1];
    return name ? pgIdentifier(name.toLowerCase()) : "";
  };
  const usedTablespaces = [...new Set(model.flatMap((table) => [tablespaceOf(table.dataTablespace), tablespaceOf(table.indexTablespace)]).filter(Boolean))];
  const mappings = new Map<string, PostgresMapping>();
  const typeNotes = new Set<string>();
  const out: string[] = [];
  const sections: { name: string; line: number }[] = [];
  let foreignKeys = 0;
  let indexes = 0;

  const schemaName = options.schemaName.trim().toLowerCase();
  const qualified = schemaName && schemaName !== "public";
  // A PostgreSQL diagram was never Oracle, so the script does not explain what Oracle had.
  const native = schema.dialect === "postgres";
  const columnCount = model.reduce((sum, table) => sum + table.columns.length, 0);

  /*
   * Every column's type, decided before anything is printed: a generated key is
   * a whole number, and a foreign-key column takes the type of the column it
   * points at -- PostgreSQL refuses a key between numeric and bigint.
   */
  const typeOf = new Map<string, string>();
  const generatedKey = (table: Table) => {
    const pk = primaryKeyColumns(table);
    return table.keyStrategy !== "none" && pk.length === 1 && pk[0].type === "NUMBER" ? pk[0].id : null;
  };
  const flagOf = new Map<string, ColumnFlag>();
  const enumTypes: { name: string; values: string[]; columnId: string }[] = [];
  for (const table of canonical.tables) {
    const key = generatedKey(table);
    for (const column of table.columns) {
      const { type } = pgType(column, native);
      const flag = column.id === key || column.fk || pgExtraOf(column) ? null : columnFlag(column);
      if (flag) flagOf.set(column.id, flag);
      if (flag?.kind === "enum") {
        const name = pgIdentifier(fit(`${normalizeIdentifier(table.name).toLowerCase()}_${normalizeIdentifier(column.name).toLowerCase()}`));
        enumTypes.push({ name, values: flag.values, columnId: column.id });
        typeOf.set(column.id, name);
      } else {
        typeOf.set(column.id, column.id === key && !/^(smallint|integer|bigint)$/.test(plainInteger(type)) ? "bigint" : column.id === key ? plainInteger(type) : type);
      }
    }
  }
  const sourceColumn = new Map(canonical.tables.flatMap((table) => table.columns.map((column) => [column.id, column] as const)));
  for (let pass = 0; pass < 3; pass++) {
    for (const ddl of model) {
      for (const fk of ddl.constraints.filter((item) => item.kind === "fk" && item.references)) {
        fk.columnIds.forEach((id, position) => {
          const target = fk.references!.columnIds[position];
          const [from, to] = [sourceColumn.get(id), sourceColumn.get(target)];
          if (from?.type === "NUMBER" && to?.type === "NUMBER" && typeOf.get(id) !== typeOf.get(target)) {
            if (pass === 0) notes.push({ level: "info", table: ddl.name, message: `${ddl.columns.find((item) => item.id === id)?.name} takes ${typeOf.get(target)}, the type of the column it points at, so the foreign key can be created.` });
            typeOf.set(id, plainInteger(typeOf.get(target)!));
          }
        });
      }
    }
  }

  out.push(
    "-- ============================================================",
    `-- PostgreSQL DDL generated by PLStudio from "${schema.name.replace(/\n/g, " ")}"`,
    "-- Target: PostgreSQL 13+",
    "", // the counts, filled in at the end, once the foreign keys PostgreSQL accepts are known
    "-- ============================================================",
    "",
  );
  if (usedTablespaces.length) {
    out.push(
      "-- Schema groups place their tables in tablespaces, as the Oracle DDL does. Create them first",
      "-- (as a superuser, outside a transaction), each in an empty directory the server owns:",
      ...usedTablespaces.map((name) => `--   create tablespace ${name} location '/var/lib/postgresql/tablespaces/${name.replace(/"/g, "")}';`),
      "",
    );
  }
  if (options.transaction) out.push("begin;", "");
  if (qualified) out.push(`create schema if not exists ${pgIdentifier(schemaName)};`, `set search_path to ${pgIdentifier(schemaName)};`, "");
  if (options.dropExisting && model.length) {
    out.push("-- Drops the tables first: everything in them is lost.", `drop table if exists ${model.map((table) => names.get(table.id)).join(", ")} cascade;`);
    if (enumTypes.length) out.push(`drop type if exists ${enumTypes.map((item) => item.name).join(", ")} cascade;`);
    out.push("");
  }

  const fkStatements: string[] = [];
  for (const ddl of model) {
    const table = tablesById.get(ddl.id) as Table;
    const name = names.get(ddl.id)!;
    const generated = generatedKey(table);
    const columnsById = new Map(table.columns.map((column) => [column.id, column]));
    const column = (id: string) => pgIdentifier(fit(ddl.columns.find((item) => item.id === id)!.name, ddl.name));
    const before: string[] = [];
    const dataSpace = tablespaceOf(ddl.dataTablespace);
    const indexSpace = tablespaceOf(ddl.indexTablespace);
    const usingIndex = indexSpace ? ` using index tablespace ${indexSpace}` : "";
    const inIndexSpace = indexSpace ? ` tablespace ${indexSpace}` : "";

    const remarks = new Map<string, string>();
    const definitions = ddl.columns.map((item) => {
      const source = columnsById.get(item.id)!;
      const { type: base, note } = pgType(source, native);
      const type = typeOf.get(item.id) ?? base;
      if (note) typeNotes.add(note);
      const label = source.size ? `${source.type}(${source.size})` : source.type;
      const mapping = mappings.get(label) ?? { oracle: label, postgres: base, count: 0 };
      mapping.count += 1;
      mappings.set(label, mapping);
      const parts = [column(item.id)];
      const flag = flagOf.get(item.id);
      if (item.id === generated) {
        parts.push(type, table.keyStrategy === "identity" ? "generated always as identity" : "generated by default as identity");
        if (table.keyStrategy === "sequence-trigger") remarks.set(item.id, "Oracle: sequence + trigger");
      } else if (flag?.kind === "enum") {
        before.push(`create type ${type} as enum (${flag.values.map(quote).join(", ")});`);
        parts.push(type);
        if (item.defaultValue) parts.push(`default ${item.defaultValue.trim()}`);
        remarks.set(item.id, `Oracle ${label} CHECK IN (${flag.values.join(", ")})`);
      } else {
        parts.push(type);
        if (item.defaultValue) {
          const expression = pgExpression(item.defaultValue);
          expression.notes.forEach((message) => notes.push({ level: "warning", table: ddl.name, message: `${item.name} default: ${message}` }));
          parts.push(`default ${expression.sql}`);
        }
      }
      // An identity column is never null already.
      if (item.notNull && item.id !== generated) parts.push("not null");
      return parts;
    });

    const constraints: string[] = [];
    for (const constraint of ddl.constraints) {
      const cols = constraint.columnIds.map(column).join(", ");
      const named = `constraint ${pgIdentifier(fit(constraint.name))}`;
      if (constraint.kind === "pk") constraints.push(`${named} primary key (${cols})${usingIndex}`);
      else if (constraint.kind === "unique") constraints.push(`${named} unique (${cols})${usingIndex}`);
      // An enum already allows only its values: the CHECK that listed them is not needed.
      else if (constraint.kind === "check" && constraint.columnIds.length === 1 && flagOf.has(constraint.columnIds[0])) continue;
      else if (constraint.kind === "check") {
        const expression = pgExpression(constraint.check ?? "");
        expression.notes.forEach((message) => notes.push({ level: "warning", table: ddl.name, message: `CHECK on ${constraint.columns.join(", ")}: ${message}` }));
        constraints.push(`${named} check (${expression.sql})`);
      } else if (constraint.kind === "fk" && constraint.references) {
        const statement = foreignKey(ddl, constraint, name, named, cols);
        // PostgreSQL only lets a foreign key point at a whole primary key or unique key.
        const target = model.find((item) => item.id === constraint.references!.tableId);
        const keys = (target?.constraints ?? []).filter((item) => item.kind === "pk" || item.kind === "unique").map((item) => item.columnIds);
        const wanted = constraint.references.columnIds;
        if (keys.some((ids) => ids.length === wanted.length && wanted.every((id) => ids.includes(id)))) {
          fkStatements.push(statement);
          foreignKeys += 1;
        } else {
          notes.push({ level: "warning", table: ddl.name, message: `${constraint.name} points at ${constraint.references.table} (${constraint.references.columns.join(", ")}), which is not its whole primary key or a unique key. PostgreSQL refuses it, so it is written as a comment: add the missing key columns to the relationship, or make the target columns unique.` });
          fkStatements.push(`-- Needs a primary or unique key on ${constraint.references.table} (${constraint.references.columns.join(", ")}):`, ...statement.split("\n").map((line) => `-- ${line}`));
        }
      }
    }

    // Lined up like the Oracle DDL: names, then types, then the rest.
    const nameWidth = Math.max(...definitions.map((parts) => parts[0].length));
    const typeWidth = Math.max(...definitions.map((parts) => parts[1].length));
    const lines = [
      ...definitions.map((parts, index) => ({ text: `  ${parts[0].padEnd(nameWidth)} ${parts.slice(2).length ? `${parts[1].padEnd(typeWidth)} ${parts.slice(2).join(" ")}` : parts[1]}`, remark: native ? undefined : remarks.get(ddl.columns[index].id) })),
      ...constraints.map((line) => ({ text: `  ${line}`, remark: undefined })),
    ];
    // The comma goes before a line's remark, which runs to the end of the line.
    const width = Math.max(...lines.map((line) => line.text.length)) + 1;
    const body = lines.map((line, index) => {
      const text = `${line.text}${index < lines.length - 1 ? "," : ""}`;
      return line.remark ? `${text.padEnd(width)} -- ${line.remark}` : text;
    });
    sections.push({ name: ddl.name, line: out.join("\n").split("\n").length });
    out.push(`-- ${ddl.name}${table.comment?.trim() ? ` — ${table.comment.trim().replace(/\s+/g, " ")}` : ""}`);
    out.push(...before, `create table ${name} (`, ...body, dataSpace ? `) tablespace ${dataSpace};` : ");");

    for (const index of ddl.indexes) {
      out.push(`create index ${pgIdentifier(fit(index.name))} on ${name} (${index.columnIds.map(column).join(", ")})${inIndexSpace};`);
      indexes += 1;
    }
    if (options.indexForeignKeys) {
      // A key already leading a primary key, unique constraint or index needs no index of its own.
      const covered = [...ddl.constraints.filter((item) => item.kind !== "fk" && item.kind !== "check").map((item) => item.columnIds), ...ddl.indexes.map((item) => item.columnIds)];
      ddl.constraints.filter((item) => item.kind === "fk").forEach((fk) => {
        if (covered.some((ids) => fk.columnIds.every((id, position) => ids[position] === id))) return;
        out.push(`create index ${pgIdentifier(fit(`${fk.name}_i`))} on ${name} (${fk.columnIds.map(column).join(", ")})${inIndexSpace};`);
        covered.push(fk.columnIds);
        indexes += 1;
      });
    }
    if (options.comments) {
      if (ddl.comment) out.push(`comment on table ${name} is ${quote(ddl.comment)};`);
      ddl.columns.filter((item) => item.comment).forEach((item) => out.push(`comment on column ${name}.${column(item.id)} is ${quote(item.comment)};`));
    }
    out.push("");
  }

  if (fkStatements.length) out.push("-- Foreign keys, after every table, so the order the tables are created in does not matter.", ...fkStatements, "");
  if (options.transaction) out.push("commit;", "");

  function foreignKey(ddl: DDLTable, constraint: DDLConstraint, table: string, named: string, cols: string) {
    const references = constraint.references!;
    const relationship = constraint.relationshipId ? relationships.get(constraint.relationshipId) : undefined;
    const target = names.get(references.tableId) ?? pgIdentifier(references.table);
    const targetColumns = references.columns.map((item) => pgIdentifier(fit(item, references.table))).join(", ");
    const onDelete = relationship ? RULE[relationship.deleteConstraint] : references.onDelete;
    const onUpdate = relationship ? RULE[relationship.updateConstraint] : "";
    if (onUpdate) notes.push({ level: "info", table: ddl.name, message: `${constraint.name}: ON UPDATE ${onUpdate.toUpperCase()} is written out; Oracle could only note it.` });
    return [
      `alter table ${table}`,
      `  add ${named} foreign key (${cols}) references ${target} (${targetColumns})${onDelete ? ` on delete ${onDelete}` : ""}${onUpdate ? ` on update ${onUpdate}` : ""};`,
    ].join("\n");
  }

  out[3] = `-- ${model.length} tables · ${columnCount} columns · ${foreignKeys} foreign keys · ${indexes} indexes`;
  typeNotes.forEach((message) => notes.unshift({ level: "info", message }));
  return {
    sql: out.join("\n"),
    notes,
    mappings: [...mappings.values()].sort((a, b) => b.count - a.count || a.oracle.localeCompare(b.oracle)),
    tables: sections,
    stats: { tables: model.length, columns: columnCount, foreignKeys, indexes },
  };
}
