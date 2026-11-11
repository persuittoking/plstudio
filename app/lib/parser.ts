import { APPEND_GAP, contentEdges, makeColumn, makeIndex, makeTable, makeUniqueConstraint, nextId, normalizeIdentifier, normalizeRelationships, PALETTE, SCHEMA_FORMAT_VERSION, type Column, type ForeignKeyRef, type OracleType, type Schema, type Table } from "./schema";
import { isMermaidER, parseMermaidER, appendMermaidER, generateMermaidER } from "./mermaid";

export type ParseResult = { schema: Schema | null; warnings: string[]; errors: string[] };

/**
 * `knownTables` lets a foreign key resolve against a table that is already in
 * the project but absent from the script being parsed -- the case whenever new
 * tables are appended to an existing diagram rather than replacing it. A
 * relationship that crosses into one of those cannot survive
 * `normalizeRelationships` run over the imported tables alone, so supplying
 * `knownTables` also defers normalization to the caller. `appendCreateTable`
 * is that caller; nobody else should need this.
 */
export type ParseOptions = { knownTables?: Table[] };

/**
 * Identifiers arrive either bare (`PF_R_CATEGORIES`, what `generateDDL` emits)
 * or quoted and schema-qualified (`"CORE"."PF_R_CATEGORIES"`, what
 * `DBMS_METADATA.GET_DDL` emits). Everything downstream works in bare names, so
 * `bareName` is applied the moment an identifier is captured.
 */
const IDENT = `(?:"[^"]*"|[A-Za-z0-9_$#]+)`;
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;
/** Constraint-state noise (`ENABLE`, `NOVALIDATE`, …) trails almost every clause a live database prints. */
const STATE_TAIL = /\s+(?:ENABLE|DISABLE|VALIDATE|NOVALIDATE|DEFERRABLE|NOT\s+DEFERRABLE|INITIALLY\s+(?:IMMEDIATE|DEFERRED)|RELY|NORELY)\s*$/i;

function bareName(value: string) {
  const parts = value.match(/"[^"]*"|[A-Za-z0-9_$#]+/g) ?? [];
  const last = parts[parts.length - 1] ?? value.trim();
  return last.startsWith('"') ? last.slice(1, -1) : last;
}

function identList(value: string) {
  return value.split(",").map((item) => bareName(item)).filter(Boolean);
}

function stripStateTail(value: string) {
  let out = value.trim();
  while (STATE_TAIL.test(out)) out = out.replace(STATE_TAIL, "").trim();
  return out;
}

/** Index of the `)` closing the `(` at `open`, or `-1`. Quote-aware in both quote flavours. */
function matchParen(value: string, open: number) {
  let depth = 0;
  let quote = false;
  let dquote = false;
  for (let i = open; i < value.length; i += 1) {
    const char = value[i];
    if (!dquote && char === "'") { quote = !quote; continue; }
    if (!quote && char === '"') { dquote = !dquote; continue; }
    if (quote || dquote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Index of the `;` ending the statement starting at `from`, or the end of input. */
function endOfStatement(value: string, from: number) {
  let depth = 0;
  let quote = false;
  let dquote = false;
  for (let i = from; i < value.length; i += 1) {
    const char = value[i];
    if (!dquote && char === "'") { quote = !quote; continue; }
    if (!quote && char === '"') { dquote = !dquote; continue; }
    if (quote || dquote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth <= 0) return i;
  }
  return value.length;
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  let dquote = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (!dquote && char === "'") { quote = !quote; continue; }
    if (!quote && char === '"') { dquote = !dquote; continue; }
    if (quote || dquote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * Oracle prints a type as base name, optional precision and optional trailing
 * words (`TIMESTAMP (6) WITH LOCAL TIME ZONE`), so the multi-word types cannot
 * be matched by a flat alternation the way the size-carrying ones can.
 */
function parseType(tail: string): { type: OracleType; size: string; rest: string } | null {
  const interval = tail.match(/^INTERVAL\s+YEAR\s*(?:\(\s*\d+\s*\))?\s+TO\s+MONTH|^INTERVAL\s+DAY\s*(?:\(\s*\d+\s*\))?\s+TO\s+SECOND\s*(?:\(\s*\d+\s*\))?/i);
  if (interval) return { type: /YEAR/i.test(interval[0]) ? "INTERVAL YEAR TO MONTH" : "INTERVAL DAY TO SECOND", size: "", rest: tail.slice(interval[0].length) };
  // The space before a precision is optional, and must not be eaten when there is none: `TIMESTAMP WITH TIME ZONE` needs it before WITH.
  const timestamp = tail.match(/^TIMESTAMP\b(?:\s*\(\s*(\d+)\s*\))?(\s+WITH\s+LOCAL\s+TIME\s+ZONE|\s+WITH\s+TIME\s+ZONE)?/i);
  if (timestamp) {
    const type = timestamp[2] ? (/LOCAL/i.test(timestamp[2]) ? "TIMESTAMP WITH LOCAL TIME ZONE" : "TIMESTAMP WITH TIME ZONE") : "TIMESTAMP";
    return { type, size: type === "TIMESTAMP" ? timestamp[1] ?? "" : "", rest: tail.slice(timestamp[0].length) };
  }
  const simple = tail.match(/^(BINARY_FLOAT|BINARY_DOUBLE|VARCHAR2|NVARCHAR2|NCHAR|CHAR|NUMBER|FLOAT|DATE|CLOB|NCLOB|BLOB|BFILE|RAW)\b\s*(?:\(([^)]*)\))?/i);
  if (!simple) return null;
  // `VARCHAR2(50 BYTE)` / `CHAR(1 CHAR)`: the length semantics are not part of the model.
  const size = (simple[2] ?? "").replace(/\s*(?:BYTE|CHAR)\s*$/i, "").replace(/\s+/g, "");
  return { type: simple[1].toUpperCase() as OracleType, size, rest: tail.slice(simple[0].length) };
}

/** Drop the quotes Oracle puts around column references so the expression round-trips as typed. */
function unquoteIdentifiers(expression: string) {
  return expression.replace(/"([A-Za-z0-9_$#]+)"/g, "$1");
}

type PendingForeignKey = { tableName: string; constraintName: string; columns: string[]; targetName: string; targetColumns: string[]; deleteAction: string };

type ParsedConstraint =
  | { kind: "pk"; columns: string[] }
  | { kind: "unique"; name: string; columns: string[] }
  | { kind: "check"; expression: string }
  | { kind: "fk"; name: string; columns: string[]; targetName: string; targetColumns: string[]; deleteAction: string }
  | { kind: "unsupported" };

const CONSTRAINT_HEAD = new RegExp(`^CONSTRAINT\\s+(${IDENT})\\s+`, "i");
const REFERENCES = new RegExp(`^\\s*REFERENCES\\s+(${QUALIFIED})\\s*\\(([^)]*)\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|SET\\s+NULL))?`, "i");

/** Parses an out-of-line constraint, from either a `CREATE TABLE` body line or an `ALTER TABLE … ADD` tail. */
function parseConstraint(raw: string): ParsedConstraint {
  const head = raw.match(CONSTRAINT_HEAD);
  const name = head ? bareName(head[1]) : "";
  const body = head ? raw.slice(head[0].length).trim() : raw.trim();
  const keyed = body.match(/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\s*\(/i);
  if (!keyed) return { kind: "unsupported" };
  const open = keyed[0].length - 1;
  const close = matchParen(body, open);
  if (close < 0) return { kind: "unsupported" };
  const inner = body.slice(open + 1, close);
  const keyword = keyed[1].toUpperCase().replace(/\s+/g, " ");
  if (keyword === "PRIMARY KEY") return { kind: "pk", columns: identList(inner) };
  if (keyword === "UNIQUE") return { kind: "unique", name, columns: identList(inner) };
  if (keyword === "CHECK") return { kind: "check", expression: unquoteIdentifiers(inner).trim() };
  const ref = body.slice(close + 1).match(REFERENCES);
  if (!ref) return { kind: "unsupported" };
  return {
    kind: "fk",
    name,
    columns: identList(inner),
    targetName: bareName(ref[1]),
    targetColumns: identList(ref[2]),
    deleteAction: ref[3] ? ref[3].toUpperCase().replace(/\s+/g, " ") : "",
  };
}

const COLUMN_HEAD = new RegExp(`^(${IDENT})\\s+([\\s\\S]+)$`);
const INLINE_CONSTRAINT_NAME = new RegExp(`\\bCONSTRAINT\\s+${IDENT}\\s+`, "gi");

/** A column definition line, plus any inline `REFERENCES` that has to wait until every table exists. */
function parseColumn(line: string): { column: Column; reference?: { targetName: string; targetColumn: string; deleteAction: string } } | null {
  const head = line.match(COLUMN_HEAD);
  if (!head) return null;
  const parsed = parseType(head[2].trim());
  if (!parsed) return null;
  const tail = stripStateTail(parsed.rest).replace(INLINE_CONSTRAINT_NAME, "");

  const checkAt = tail.search(/\bCHECK\s*\(/i);
  const checkOpen = checkAt < 0 ? -1 : tail.indexOf("(", checkAt);
  const checkClose = checkOpen < 0 ? -1 : matchParen(tail, checkOpen);
  const check = checkClose > 0 ? unquoteIdentifiers(tail.slice(checkOpen + 1, checkClose)).trim() : "";

  const defaultValue = tail.match(/\bDEFAULT\s+(?:ON\s+NULL\s+)?(.+?)(?=\s+NOT\s+NULL\b|\s+NULL\b|\s+UNIQUE\b|\s+PRIMARY\s+KEY\b|\s+CHECK\b|\s+REFERENCES\b|\s+GENERATED\b|$)/i)?.[1]?.trim() ?? "";

  const refMatch = tail.slice(checkClose + 1).match(new RegExp(`\\bREFERENCES\\s+(${QUALIFIED})\\s*\\(\\s*(${IDENT})\\s*\\)(?:\\s+ON\\s+DELETE\\s+(CASCADE|SET\\s+NULL))?`, "i"));

  const column = makeColumn({
    name: bareName(head[1]),
    type: parsed.type,
    size: parsed.size,
    notNull: /\bNOT\s+NULL\b/i.test(tail),
    pk: /\bPRIMARY\s+KEY\b/i.test(tail),
    unique: /\bUNIQUE\b/i.test(tail),
    check,
    defaultValue,
  });
  if (column.pk) column.notNull = true;
  return refMatch
    ? { column, reference: { targetName: bareName(refMatch[1]), targetColumn: bareName(refMatch[2]), deleteAction: refMatch[3] ? refMatch[3].toUpperCase().replace(/\s+/g, " ") : "" } }
    : { column };
}

function unescapeComment(value: string) {
  return value.replaceAll("''", "'");
}

export function findTable(tables: Table[], name: string) {
  return tables.find((table) => normalizeIdentifier(table.name) === normalizeIdentifier(name));
}

export function findColumn(table: Table, name: string) {
  return table.columns.find((column) => normalizeIdentifier(column.name) === normalizeIdentifier(name));
}

/** The only column of `table` the expression names, or `null` when it names none or several. */
function checkTarget(table: Table, expression: string) {
  const referenced = new Set<Column>();
  // Literals first: `CHECK (STATE IN ('CODE'))` must not count a column named CODE.
  (expression.replace(/'(?:''|[^'])*'/g, " ").match(/[A-Za-z0-9_$#]+/g) ?? []).forEach((word) => {
    const column = findColumn(table, word);
    if (column) referenced.add(column);
  });
  return referenced.size === 1 ? [...referenced][0] : null;
}

export function parseCreateTable(sql: string, options: ParseOptions = {}): ParseResult {
  if (isMermaidER(sql)) {
    return parseMermaidER(sql, options);
  }
  const knownTables = options.knownTables ?? [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const tables: Table[] = [];
  const identityTables = new Set<string>();
  const foreignKeys: PendingForeignKey[] = [];
  const applyUnique = (tableName: string, name: string, columns: string[]) => {
    const table = findTable(tables, tableName);
    if (!table) return;
    const resolved = columns.map((columnName) => {
      const column = findColumn(table, columnName);
      if (!column) errors.push(`${tableName}: unique column ${columnName} not found.`);
      return column;
    });
    if (resolved.some((column) => !column)) return;
    // A single column stays the column's own flag, so the DDL this generator
    // emits parses back to the shape it was generated from.
    if (resolved.length === 1) { resolved[0]!.unique = true; return; }
    table.uniques = [...(table.uniques ?? []), makeUniqueConstraint(resolved.map((column) => column!.id), name)];
  };
  const applyPrimary = (tableName: string, columns: string[]) => {
    const table = findTable(tables, tableName);
    if (!table) return;
    columns.forEach((name) => {
      const column = findColumn(table, name);
      if (column) { column.pk = true; column.notNull = true; }
      else errors.push(`${tableName}: primary key column ${name} not found.`);
    });
  };
  const applyCheck = (tableName: string, expression: string) => {
    const table = findTable(tables, tableName);
    if (!table) return;
    const column = checkTarget(table, expression);
    if (column) column.check = expression;
    else warnings.push(`${tableName}: skipped table-level check constraint: ${expression}`);
  };

  const tableRegex = new RegExp(`CREATE\\s+(?:GLOBAL\\s+TEMPORARY\\s+|PRIVATE\\s+TEMPORARY\\s+)?TABLE\\s+(${QUALIFIED})\\s*\\(`, "gi");
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(sql))) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) { errors.push(`${bareName(match[1])}: unterminated CREATE TABLE body.`); break; }
    tableRegex.lastIndex = close + 1;
    const tableName = bareName(match[1]);
    const table = makeTable(tableName, 80 + tables.length * 330, 90 + (tables.length % 3) * 170, tables.length);
    table.columns = [];
    // Table-level clauses are deferred: a PK may name a column defined below it,
    // and an FK may target a table defined later in the script.
    const inlineConstraints: string[] = [];
    const inlineReferences: Array<{ column: Column; targetName: string; targetColumn: string; deleteAction: string }> = [];
    splitTopLevel(sql.slice(open + 1, close)).forEach((line) => {
      if (/^(?:CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\s*\(|FOREIGN\s+KEY\b|CHECK\s*\()/i.test(line)) { inlineConstraints.push(line); return; }
      const parsed = parseColumn(line);
      if (!parsed) { warnings.push(`${tableName}: could not parse line: ${line}`); return; }
      table.columns.push(parsed.column);
      if (/\bGENERATED\b[\s\S]*\bAS\s+IDENTITY\b/i.test(line)) identityTables.add(table.id);
      if (parsed.reference) inlineReferences.push({ column: parsed.column, ...parsed.reference });
    });
    if (!table.columns.length) errors.push(`${tableName}: no columns were parsed.`);
    tables.push(table);

    inlineConstraints.forEach((raw) => {
      const constraint = parseConstraint(raw);
      if (constraint.kind === "pk") applyPrimary(tableName, constraint.columns);
      else if (constraint.kind === "unique") applyUnique(tableName, constraint.name, constraint.columns);
      else if (constraint.kind === "check") applyCheck(tableName, constraint.expression);
      else if (constraint.kind === "fk") foreignKeys.push({ tableName, constraintName: constraint.name, columns: constraint.columns, targetName: constraint.targetName, targetColumns: constraint.targetColumns, deleteAction: constraint.deleteAction });
      else warnings.push(`${tableName}: skipped unsupported table constraint: ${raw}`);
    });
    inlineReferences.forEach((reference) => foreignKeys.push({
      tableName,
      constraintName: "",
      columns: [reference.column.name],
      targetName: reference.targetName,
      targetColumns: [reference.targetColumn],
      deleteAction: reference.deleteAction,
    }));
  }

  const alterRegex = new RegExp(`ALTER\\s+TABLE\\s+(${QUALIFIED})\\s+ADD\\s+`, "gi");
  let alter: RegExpExecArray | null;
  while ((alter = alterRegex.exec(sql))) {
    const tableName = bareName(alter[1]);
    const end = endOfStatement(sql, alter.index + alter[0].length);
    const raw = sql.slice(alter.index + alter[0].length, end).trim();
    alterRegex.lastIndex = end;
    if (!findTable(tables, tableName)) continue;
    const constraint = parseConstraint(raw);
    if (constraint.kind === "pk") applyPrimary(tableName, constraint.columns);
    else if (constraint.kind === "unique") applyUnique(tableName, constraint.name, constraint.columns);
    else if (constraint.kind === "check") applyCheck(tableName, constraint.expression);
    else if (constraint.kind === "fk") foreignKeys.push({ tableName, constraintName: constraint.name, columns: constraint.columns, targetName: constraint.targetName, targetColumns: constraint.targetColumns, deleteAction: constraint.deleteAction });
    else warnings.push(`${tableName}: skipped unsupported table constraint: ${raw}`);
  }

  /*
   * `create [unique] index`. A unique one is the same thing as a unique
   * constraint as far as the model goes; anything fancier than a plain column
   * list (function-based, bitmap options aside) is reported and skipped.
   */
  const indexRegex = new RegExp(`CREATE\\s+(UNIQUE\\s+|BITMAP\\s+)?INDEX\\s+(${QUALIFIED})\\s+ON\\s+(${QUALIFIED})\\s*\\(`, "gi");
  let index: RegExpExecArray | null;
  while ((index = indexRegex.exec(sql))) {
    const open = index.index + index[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) break;
    indexRegex.lastIndex = close + 1;
    const tableName = bareName(index[3]);
    const indexName = bareName(index[2]);
    const table = findTable(tables, tableName);
    if (!table) continue;
    const inner = sql.slice(open + 1, close);
    const columnNames = identList(inner.replace(/\s+(?:ASC|DESC)\b/gi, ""));
    const columns = columnNames.map((name) => findColumn(table, name));
    // `upper(name)` would otherwise read as the bare column `name`.
    if (/[()]/.test(inner) || !columns.length || columns.some((column) => !column)) {
      warnings.push(`${tableName}: skipped index ${indexName}; only plain column indexes are supported.`);
      continue;
    }
    if (/UNIQUE/i.test(index[1] ?? "")) applyUnique(tableName, indexName, columnNames);
    else table.indexes = [...(table.indexes ?? []), makeIndex(columns.map((column) => column!.id), indexName)];
  }

  const importedRelationships: Array<Record<string, unknown>> = [];
  foreignKeys.forEach((foreignKey) => {
    const table = findTable(tables, foreignKey.tableName);
    // A table in the script shadows a project table of the same name: the
    // script is the more specific statement about what that name means here.
    const target = findTable(tables, foreignKey.targetName) ?? findTable(knownTables, foreignKey.targetName);
    const pairs = foreignKey.columns.map((columnName, index) => ({
      column: table && findColumn(table, columnName),
      targetColumn: target && findColumn(target, foreignKey.targetColumns[index] ?? ""),
    }));
    if (!table || !target || !pairs.length || !pairs.every((pair) => pair.column && pair.targetColumn)) {
      warnings.push(`${foreignKey.tableName}: skipped foreign key to ${foreignKey.targetName}.${foreignKey.targetColumns.join(", ")}.`);
      return;
    }
    pairs.forEach((pair) => { pair.column!.fk = { tableId: target.id, columnId: pair.targetColumn!.id }; });
    importedRelationships.push({
      id: `rel_${importedRelationships.length + 1}`,
      startTableId: table.id,
      startFieldId: pairs[0].column!.id,
      endTableId: target.id,
      endFieldId: pairs[0].targetColumn!.id,
      fields: pairs.map((pair) => ({ startFieldId: pair.column!.id, endFieldId: pair.targetColumn!.id })),
      name: foreignKey.constraintName,
      deleteConstraint: foreignKey.deleteAction === "CASCADE" ? "Cascade" : foreignKey.deleteAction ? "Set null" : "No action",
    });
  });

  sql.replace(new RegExp(`COMMENT\\s+ON\\s+TABLE\\s+(${QUALIFIED})\\s+IS\\s+'((?:''|[^'])*)'`, "gi"), (statement, tableName: string, comment: string) => {
    const table = findTable(tables, bareName(tableName));
    if (table) table.comment = unescapeComment(comment);
    return statement;
  });

  sql.replace(new RegExp(`COMMENT\\s+ON\\s+COLUMN\\s+(${QUALIFIED})\\s*\\.\\s*(${IDENT})\\s+IS\\s+'((?:''|[^'])*)'`, "gi"), (statement, tableName: string, columnName: string, comment: string) => {
    const table = findTable(tables, bareName(tableName));
    const column = table && findColumn(table, bareName(columnName));
    if (column) column.comment = unescapeComment(comment);
    return statement;
  });

  tables.forEach((table) => {
    const keys = table.columns.filter((column) => column.pk).length;
    table.keyStrategy = keys !== 1 ? "none" : identityTables.has(table.id) ? "identity" : "sequence-trigger";
  });

  if (!tables.length) errors.push("No supported CREATE TABLE statements found.");
  if (errors.length) return { schema: null, warnings, errors };
  const imported = { id: `schema_import_${Date.now()}`, name: "Imported Oracle Schema", revision: 1, schemaFormatVersion: SCHEMA_FORMAT_VERSION, tables, relationships: importedRelationships as never[] };
  return { schema: options.knownTables ? imported : normalizeRelationships(imported), warnings, errors };
}

export type AppendResult = {
  schema: Schema | null;
  /** The tables as they were placed, for selecting and revealing them. */
  added: Table[];
  /** Names the script declares that the project already has, left untouched. */
  skipped: string[];
  warnings: string[];
  errors: string[];
};

/**
 * Parse `sql` and append its tables to `base` instead of replacing it.
 *
 * A name the project already carries is *not* overwritten -- the existing table
 * wins and the script's version is reported as skipped, because the alternative
 * (silently merging two definitions of one table) is unpredictable and the user
 * can always delete the old one first. Foreign keys still resolve across the
 * seam in both directions: a script that references a table it does not declare
 * finds the project's, and a reference to a skipped table is re-pointed at the
 * project's table and column of that name.
 */
export function appendCreateTable(
  base: Schema,
  sql: string,
  /** The reader of the script: Oracle's by default; the PostgreSQL import passes its own (`app/lib/postgres-import.ts`). */
  parse: (sql: string, options: ParseOptions) => ParseResult = parseCreateTable,
): AppendResult {
  if (isMermaidER(sql)) {
    return appendMermaidER(base, sql);
  }
  const parsed = parse(sql, { knownTables: base.tables });
  if (!parsed.schema) return { schema: null, added: [], skipped: [], warnings: parsed.warnings, errors: parsed.errors };

  /** Imported table id -> the project table of the same name it defers to. */
  const deferred = new Map<string, Table>();
  /** Column id inside a deferred table -> the project column of the same name. */
  const deferredColumns = new Map<string, string>();
  const skipped: string[] = [];
  const fresh: Table[] = [];
  parsed.schema.tables.forEach((table) => {
    const match = findTable(base.tables, table.name);
    if (!match) { fresh.push(table); return; }
    // The project's spelling, not the script's: the project's table is the one
    // that survives, and `generateDDL` round-trips names in a different case.
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

  const rewire = (ref: ForeignKeyRef | null): ForeignKeyRef | null => {
    if (!ref) return null;
    const target = deferred.get(ref.tableId);
    if (!target) return ref;
    const columnId = deferredColumns.get(ref.columnId);
    return columnId ? { tableId: target.id, columnId } : null;
  };

  const edges = contentEdges(base);
  const originX = Math.min(...fresh.map((table) => table.x));
  const originY = Math.min(...fresh.map((table) => table.y));
  const dx = edges ? edges.left - originX : 0;
  const dy = edges ? edges.bottom + APPEND_GAP - originY : 0;
  const added = fresh.map((table, index) => ({
    ...table,
    x: table.x + dx,
    y: table.y + dy,
    // Carry on round the palette rather than restarting it under the diagram.
    color: PALETTE[(base.tables.length + index) % PALETTE.length],
    columns: table.columns.map((column) => ({ ...column, fk: rewire(column.fk) })),
  }));

  const addedIds = new Set(added.map((table) => table.id));
  const relationships = (parsed.schema.relationships ?? [])
    // A relationship owned by a skipped table describes the project's table, not the script's.
    .filter((relationship) => addedIds.has(relationship.startTableId))
    .map((relationship) => ({
      ...relationship,
      // The parser numbers from rel_1, which the project has already used.
      id: nextId("rel"),
      endTableId: deferred.get(relationship.endTableId)?.id ?? relationship.endTableId,
      endFieldId: deferredColumns.get(relationship.endFieldId) ?? relationship.endFieldId,
      fields: relationship.fields.map((pair) => ({
        startFieldId: pair.startFieldId,
        endFieldId: deferredColumns.get(pair.endFieldId) ?? pair.endFieldId,
      })),
    }));

  /*
   * `normalizeRelationships` drops every `column.fk` no relationship accounts
   * for. On a schema whose relationships were never materialised that would
   * quietly cut the project's own foreign keys, so derive them first.
   */
  const ground = base.relationships?.length ? base : normalizeRelationships(base);
  const schema = normalizeRelationships({
    ...ground,
    tables: [...ground.tables, ...added],
    relationships: [...(ground.relationships ?? []), ...relationships],
  });
  return { schema, added, skipped, warnings: parsed.warnings, errors: [] };
}

export { isMermaidER, parseMermaidER, appendMermaidER, generateMermaidER };
