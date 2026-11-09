import {
  normalizeIdentifier,
  normalizeGroups,
  normalizeRelationships,
  primaryKeyColumns,
  type PackageProcedure,
  type Schema,
  type SchemaPackage,
  type Table,
  type Column,
  typeString,
} from "./schema";

function shorten(value: string, used: Set<string>) {
  const clean = normalizeIdentifier(value).toLowerCase();
  if (clean.length <= 128 && !used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const hash = [...clean]
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 46656, 7)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  const candidate = `${clean.slice(0, 124 - hash.length)}_${hash}`;
  used.add(candidate);
  return candidate;
}

function sqlIdentifier(value: string) {
  return normalizeIdentifier(value).toLowerCase();
}

function sqlComment(value: string) {
  return value.replaceAll("'", "''");
}

/**
 * Everything `generateDDL` prints, resolved but not yet printed: identifiers
 * normalized, constraint and sequence names minted through the one shared
 * `shorten` set, in the order the DDL mints them. The migration generator diffs
 * two of these, which is the only way its constraint names can agree with the
 * ones the original DDL actually created.
 */
export type DDLColumn = {
  id: string;
  name: string;
  /** `varchar2(100)`, lower-case as printed. */
  type: string;
  identity: boolean;
  defaultValue: string;
  notNull: boolean;
  comment: string;
};

export type DDLConstraint = {
  kind: "pk" | "unique" | "check" | "fk";
  name: string;
  columnIds: string[];
  columns: string[];
  check?: string;
  references?: { tableId: string; table: string; columnIds: string[]; columns: string[]; onDelete: string };
  /** The canvas edge a foreign key was generated from. */
  relationshipId?: string;
  /** `-- DrawDB on …` lines printed ahead of a foreign key. */
  notes?: string[];
};

/** A plain `create index`, kept apart from `constraints` so their numbering never moves. */
export type DDLIndex = { name: string; columnIds: string[]; columns: string[] };

export type DDLTable = {
  id: string;
  name: string;
  columns: DDLColumn[];
  dataTablespace: string;
  indexTablespace: string;
  constraints: DDLConstraint[];
  indexes: DDLIndex[];
  comment: string;
  /** Minted only for `sequence-trigger` tables with a single NUMBER key. */
  sequence?: string;
};

const hasSequence = (table: Table) => {
  const pk = primaryKeyColumns(table);
  return table.keyStrategy === "sequence-trigger" && pk.length === 1 && pk[0].type === "NUMBER";
};

export function ddlModel(schema: Schema): DDLTable[] {
  const usedNames = new Set<string>();
  const canonical = normalizeGroups(normalizeRelationships({
    ...schema,
    relationships: schema.relationships?.length
      ? schema.relationships
      : undefined,
  }), true);
  const groupsById = new Map((canonical.groups ?? []).map((group) => [group.id, group]));
  const tablesById = new Map<string, Table>();
  canonical.tables.forEach((table) => { if (!tablesById.has(table.id)) tablesById.set(table.id, table); });
  const relationshipsByTable = new Map<string, NonNullable<Schema["relationships"]>>();
  canonical.relationships?.forEach((relationship) => {
    const current = relationshipsByTable.get(relationship.startTableId) ?? [];
    current.push(relationship);
    relationshipsByTable.set(relationship.startTableId, current);
  });

  const tables = canonical.tables.map((table): DDLTable => {
    const tableName = sqlIdentifier(table.name);
    const pk = primaryKeyColumns(table);
    const outgoing = relationshipsByTable.get(table.id) ?? [];
    const columns = table.columns.map((column): DDLColumn => ({
      id: column.id,
      name: sqlIdentifier(column.name),
      type: typeString(column).toLowerCase(),
      identity: table.keyStrategy === "identity" && column.pk && pk.length === 1 && column.type === "NUMBER",
      defaultValue: column.defaultValue.trim(),
      notNull: column.notNull || column.pk,
      comment: column.comment?.trim() ?? "",
    }));
    const byId = new Map(columns.map((column) => [column.id, column]));
    const names = (ids: string[]) => ids.map((id) => byId.get(id)!.name);
    const group = table.schemaId ? groupsById.get(table.schemaId) : undefined;
    /*
     * The keyword is the module's short code, which is what a tablespace is
     * actually named after; the group's display name is prose, and
     * `MLL -- MULTI LANGUAGE TOOLS` normalizes to the unusable
     * `mll___multi_language_tools_data`. Falling back to the name keeps every
     * diagram written before keywords generating byte-identical DDL.
     */
    const tablespace = group ? sqlIdentifier(group.keyword?.trim() || group.name) : "";
    const constraints: DDLConstraint[] = [];
    if (pk.length) {
      const ids = pk.map((column) => column.id);
      constraints.push({ kind: "pk", name: shorten(`${tableName}_pk`, usedNames), columnIds: ids, columns: names(ids) });
    }
    const columnUniques = table.columns.filter((column) => column.unique);
    columnUniques.forEach((column, index) =>
      constraints.push({ kind: "unique", name: shorten(`${tableName}_u${index + 1}`, usedNames), columnIds: [column.id], columns: names([column.id]) }),
    );
    /*
     * Numbered on from the single-column ones so a diagram that has none of
     * these generates byte-identical DDL to the build before they existed.
     */
    (table.uniques ?? []).forEach((constraint, index) => {
      if (!constraint.columnIds.every((id) => byId.has(id))) return;
      const name = constraint.name?.trim() || `${tableName}_u${columnUniques.length + index + 1}`;
      constraints.push({ kind: "unique", name: shorten(name, usedNames), columnIds: constraint.columnIds, columns: names(constraint.columnIds) });
    });
    table.columns
      .filter((column) => column.check.trim())
      .forEach((column, index) =>
        constraints.push({ kind: "check", name: shorten(`${tableName}_c${index + 1}`, usedNames), columnIds: [column.id], columns: names([column.id]), check: column.check.trim() }),
      );
    outgoing.forEach((relationship, index) => {
      const endTable = tablesById.get(relationship.endTableId);
      if (!endTable) return;
      const pairs = relationship.fields.length
        ? relationship.fields
        : [{ startFieldId: relationship.startFieldId, endFieldId: relationship.endFieldId }];
      const startColumns = pairs.map((pair) => table.columns.find((column) => column.id === pair.startFieldId)).filter((column): column is Column => Boolean(column));
      const endColumns = pairs.map((pair) => endTable.columns.find((column) => column.id === pair.endFieldId)).filter((column): column is Column => Boolean(column));
      if (startColumns.length !== pairs.length || endColumns.length !== pairs.length) return;
      const onDelete =
        relationship.deleteConstraint === "Cascade" || relationship.deleteConstraint === "Set null"
          ? relationship.deleteConstraint.toLowerCase()
          : "";
      const notes = [
        ...(relationship.updateConstraint !== "No action" ? [`-- DrawDB on update: ${relationship.updateConstraint}`] : []),
        ...(relationship.deleteConstraint !== "No action" && !onDelete ? [`-- DrawDB on delete: ${relationship.deleteConstraint}`] : []),
      ];
      const ids = startColumns.map((column) => column.id);
      constraints.push({
        kind: "fk",
        name: shorten(relationship.name || `${tableName}_f${index + 1}`, usedNames),
        columnIds: ids,
        columns: names(ids),
        references: {
          tableId: endTable.id,
          table: sqlIdentifier(endTable.name),
          columnIds: endColumns.map((column) => column.id),
          columns: endColumns.map((column) => sqlIdentifier(column.name)),
          onDelete,
        },
        relationshipId: relationship.id,
        notes,
      });
    });
    // Minted after the table's constraints, so a diagram with no indexes names
    // everything exactly as it did before indexes existed.
    const indexes = (table.indexes ?? [])
      .filter((index) => index.columnIds.length && index.columnIds.every((id) => byId.has(id)))
      .map((index, position): DDLIndex => ({
        name: shorten(index.name?.trim() || `${tableName}_i${position + 1}`, usedNames),
        columnIds: index.columnIds,
        columns: names(index.columnIds),
      }));
    return {
      id: table.id,
      name: tableName,
      columns,
      dataTablespace: group ? ` tablespace ${tablespace}_data` : "",
      indexTablespace: group ? ` tablespace ${tablespace}_index` : "",
      constraints,
      indexes,
      comment: table.comment?.trim() ?? "",
    };
  });
  // Sequences are named after every constraint, exactly as they are printed.
  canonical.tables.forEach((table, index) => {
    if (hasSequence(table)) tables[index].sequence = shorten(`${sqlIdentifier(table.name)}_seq`, usedNames);
  });
  return tables;
}

/** `create table` plus its column list, as `generateDDL` prints it. */
export function createTableLines(table: DDLTable) {
  const width = Math.max(...table.columns.map((column) => column.name.length), 0);
  return [
    `create table ${table.name} (`,
    table.columns.map((column) => `  ${column.name.padEnd(width + 3)}${columnSpec(column)}`).join(",\n"),
    `)${table.dataTablespace};`,
  ];
}

/** A column's type and attributes: everything after its name. */
export function columnSpec(column: DDLColumn) {
  const attrs = [column.defaultValue ? `default ${column.defaultValue}` : "", column.notNull ? "not null" : ""].filter(Boolean).join(" ");
  return `${column.type}${column.identity ? " generated always as identity" : ""}${attrs ? ` ${attrs}` : ""}`;
}

/** One constraint as its own `alter table … add constraint` statement. */
export function addConstraintLines(table: Pick<DDLTable, "name" | "indexTablespace">, constraint: DDLConstraint) {
  const columns = constraint.columns.join(", ");
  switch (constraint.kind) {
    case "pk":
    case "unique":
      return [
        `alter table ${table.name}`,
        `  add constraint ${constraint.name} ${constraint.kind === "pk" ? "primary key" : "unique"} (${columns})`,
        `  using index${table.indexTablespace};`,
      ];
    case "check":
      return [`alter table ${table.name}`, `  add constraint ${constraint.name}`, `  check (${constraint.check});`];
    case "fk": {
      const ref = constraint.references!;
      return [
        ...(constraint.notes ?? []),
        `alter table ${table.name}`,
        `  add constraint ${constraint.name}`,
        `  foreign key (${columns}) references ${ref.table}(${ref.columns.join(", ")})${ref.onDelete ? ` on delete ${ref.onDelete}` : ""};`,
      ];
    }
  }
}

/** One `create index` statement. */
export function indexLines(table: Pick<DDLTable, "name" | "indexTablespace">, index: DDLIndex) {
  return [`create index ${index.name} on ${table.name} (${index.columns.join(", ")})${table.indexTablespace};`];
}

export function sequenceLines(name: string) {
  return [`create sequence ${name}`, "start with 1", "increment by 1", "nocache", "nocycle;"];
}

export const commentLines = (table: DDLTable) => [
  ...(table.comment ? [`comment on table ${table.name} is '${sqlComment(table.comment)}';`] : []),
  ...table.columns.filter((column) => column.comment).map((column) => `comment on column ${table.name}.${column.name} is '${sqlComment(column.comment)}';`),
];

export function generateDDL(schema: Schema) {
  const out = [
    "-- ============================================================",
    "-- Oracle DDL generated by Oracle Schema Designer",
    "-- Target: Oracle 12.2+",
    "-- ============================================================\n",
  ];
  const tables = ddlModel(schema);
  tables.forEach((table) => {
    out.push(`--drop table ${table.name};`, "--", ...createTableLines(table), "--");
    table.constraints.forEach((constraint) => out.push(...addConstraintLines(table, constraint), "--"));
    table.indexes.forEach((index) => out.push(...indexLines(table, index), "--"));
    out.push(...commentLines(table), "");
  });
  const sequences = tables.flatMap((table) => (table.sequence ? [table.sequence] : []));
  sequences.forEach((name, index) =>
    out.push(...sequenceLines(name), ...(index < sequences.length - 1 ? ["---------------------------------------------------------"] : [])),
  );
  return out.join("\n");
}

function param(column: Column, tableName: string, mode = "IN") {
  return `p_${normalizeIdentifier(column.name).toLowerCase()} ${mode} ${tableName}.${normalizeIdentifier(column.name)}%TYPE`;
}

function toSingularToken(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith("ies") && lower.length > 4) {
    return word.slice(0, -3) + (word[word.length - 1] === "S" ? "Y" : "y");
  }
  /*
   * Only a sibilant stem takes a real `-es` plural (boxes, matches, statuses).
   * Everywhere else the `e` belongs to the singular and just the `s` comes off
   * -- TYPES is TYPE, not TYP. Matching the stem is what makes that hold; the
   * older blacklist of `-tes`/`-ses`/`-ces` endings did not.
   */
  if (/(?:s|x|z|ch|sh)es$/.test(lower)) return word.slice(0, -2);
  if (lower.endsWith("s") && !/(?:ss|us|is)$/.test(lower)) {
    return word.slice(0, -1);
  }
  return word;
}

function getProcedureSuffix(tableName: string): string {
  let clean = tableName;
  if (/^Osm_R_Action_/i.test(clean) && !/^(Osm_R_Actions|Osm_R_Action_Fields|Osm_R_Action_Validates)$/i.test(clean)) {
    clean = clean.replace(/^Osm_R_Action_/i, "");
  } else if (/^Osm_R_/i.test(clean)) {
    clean = clean.replace(/^Osm_R_/i, "");
  } else if (/^[A-Za-z0-9]+_R_/i.test(clean)) {
    clean = clean.replace(/^[A-Za-z0-9]+_R_/i, "");
  } else if (/^[A-Za-z0-9]+_/i.test(clean)) {
    clean = clean.replace(/^[A-Za-z0-9]+_/i, "");
  }

  const parts = clean.split("_").filter(Boolean);
  const formatted = parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    let token = part.charAt(0).toUpperCase() + part.slice(1);
    if (isLast) {
      token = toSingularToken(token);
    }
    return token;
  });

  return formatted.join("_");
}

export function getPackageName(schema: Schema): string {
  for (const table of schema.tables) {
    const match = table.name.match(/^([A-Za-z0-9]+)_/);
    if (match && match[1]) {
      const prefix = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      if (prefix.toLowerCase() !== "r") {
        return `${prefix}_Dml`;
      }
    }
  }
  return "Osm_Dml";
}

/**
 * Which columns each generated procedure names, decided once per table. Both
 * `generateDML` and impact analysis read it, so "what does `Upd_X` touch" has
 * exactly one answer.
 */
export function dmlPlan(table: Table) {
  const tableName = table.name.trim();
  const pkCols = primaryKeyColumns(table);
  const updCols = table.columns.filter((c) => !c.pk);
  return {
    tableName,
    procSuffix: getProcedureSuffix(tableName),
    pkCols,
    hasSingleNumberPk: pkCols.length === 1 && pkCols[0].type === "NUMBER",
    modifyOnCol: table.columns.find((c) => c.name.toLowerCase().replace(/_/g, "") === "modifyon"),
    modifyByCol: table.columns.find((c) => c.name.toLowerCase().replace(/_/g, "") === "modifyby"),
    stateCol: table.columns.find((c) => c.name.toLowerCase() === "state"),
    /** Log tables get an insert procedure and nothing else. */
    isLogTable: /(_log|_logs|_audit|_audits)$/i.test(tableName) || /log|audit/i.test(tableName),
    sequenceName: `${tableName}_Seq`,
    setCols: updCols.length > 0 ? updCols : table.columns,
    whereCols: pkCols.length > 0 ? pkCols : table.columns,
  };
}

const DML_SEP = "  -----------------------------------------------------------------------------------------------------------";

/** One generated subprogram: its signature (shared by spec and body) and the lines after `is`. */
type DmlProcedure = { signature: string; body: string[] };

/** The Ins/Upd/Del procedures of one table, in the order the package body prints them. */
function tableProcedures(table: Table): DmlProcedure[] {
  const { tableName, procSuffix, pkCols, hasSingleNumberPk, modifyOnCol, modifyByCol, stateCol, isLogTable, sequenceName, setCols, whereCols } = dmlPlan(table);
  const procs: DmlProcedure[] = [];
  const aligned = (assignments: { lhs: string; rhs: string }[]) => {
    if (!assignments.length) return [];
    const width = Math.max(...assignments.map((a) => a.lhs.length));
    return [...assignments.map((a) => `    ${a.lhs.padEnd(width)} := ${a.rhs}`), "    --"];
  };
  const audit = (): { lhs: string; rhs: string }[] => [
    ...(modifyOnCol ? [{ lhs: `Io_Row.${modifyOnCol.name}`, rhs: "sysdate;" }] : []),
    ...(modifyByCol ? [{ lhs: `Io_Row.${modifyByCol.name}`, rhs: "Core.User_Env.Get_User_Id;" }] : []),
  ];

  // 1. Ins Procedure
  procs.push({
    signature: `Procedure Ins_${procSuffix}(Io_Row in out nocopy ${tableName}%rowtype)`,
    body: [
      "  begin",
      ...aligned([...(hasSingleNumberPk ? [{ lhs: `Io_Row.${pkCols[0].name}`, rhs: `${sequenceName}.Nextval;` }] : []), ...audit()]),
      `    insert into ${tableName} values Io_Row;`,
      "  end;",
    ],
  });
  if (isLogTable) return procs;

  // 2. Upd Procedure
  const maxSetColLen = Math.max(...setCols.map((c) => c.name.length));
  procs.push({
    signature: `Procedure Upd_${procSuffix}(Io_Row in out nocopy ${tableName}%rowtype)`,
    body: [
      "  begin",
      ...aligned(audit()),
      `    update ${tableName}`,
      ...setCols.map((c, idx) => `    ${idx === 0 ? "       set " : "           "}${c.name.padEnd(maxSetColLen)} = Io_Row.${c.name}${idx < setCols.length - 1 ? "," : ""}`),
      ...whereCols.map((c, idx) => `    ${idx === 0 ? "     where " : "       and "}${c.name} = Io_Row.${c.name}${idx === whereCols.length - 1 ? ";" : ""}`),
      "  end;",
    ],
  });

  // 3. Del Procedure
  const delParams = whereCols
    .map((c) => {
      const typeLower = c.type.toLowerCase();
      return `i_${c.name} ${typeLower === "number" ? "number" : typeLower === "date" ? "date" : "varchar2"}`;
    })
    .join(", ");
  const softSetCols = stateCol
    ? [{ name: stateCol.name, val: "'P'" }, ...(modifyOnCol ? [{ name: modifyOnCol.name, val: "sysdate" }] : []), ...(modifyByCol ? [{ name: modifyByCol.name, val: "Core.User_Env.Get_User_Id" }] : [])]
    : [];
  const maxSoftColLen = Math.max(0, ...softSetCols.map((s) => s.name.length));
  procs.push({
    signature: `Procedure Del_${procSuffix}(${delParams})`,
    body: [
      "  begin",
      ...(stateCol
        ? [
            `    update ${tableName}`,
            ...softSetCols.map((s, idx) => `    ${idx === 0 ? "       set " : "           "}${s.name.padEnd(maxSoftColLen)} = ${s.val}${idx < softSetCols.length - 1 ? "," : ""}`),
            ...whereCols.map((c, idx) => `    ${idx === 0 ? "     where " : "       and "}${c.name} = i_${c.name}${idx === whereCols.length - 1 ? ";" : ""}`),
          ]
        : [`    delete from ${tableName} where ${whereCols.map((c) => `${c.name} = i_${c.name}`).join(" and ")};`]),
      "  end;",
    ],
  });
  return procs;
}

/** A hand-written subprogram: header from its fields, body verbatim (indented two spaces). */
function customProcedure(proc: PackageProcedure): DmlProcedure {
  const name = proc.name.trim() || "Unnamed";
  const params = proc.params.trim();
  const head = `${proc.kind === "function" ? "Function" : "Procedure"} ${name}${params ? `(${params})` : ""}`;
  return {
    signature: proc.kind === "function" ? `${head} return ${proc.returns?.trim() || "varchar2"}` : head,
    body: proc.body.trim() ? proc.body.replace(/\s+$/, "").split("\n").map((line) => `  ${line}`) : ["  begin", "    null;", "  end;"],
  };
}

const packageBodyLines = (name: string, procs: DmlProcedure[], declarations = "") => [
  `create or replace package body ${name} is`,
  ...(declarations.trim() ? declarations.replace(/\s+$/, "").split("\n") : []),
  ...procs.flatMap((proc) => [DML_SEP, `  ${proc.signature} is`, ...proc.body]),
  DML_SEP,
  `end ${name};`,
];

const packageSpecLines = (name: string, procs: DmlProcedure[]) => [
  `create or replace package ${name} is`,
  ...procs.flatMap((proc) => [DML_SEP, `  ${proc.signature};`]),
  DML_SEP,
  `end ${name};`,
];

/** The subprograms a package carries: its covered tables' CRUD, then its own, in that order. */
export function packageProcedures(schema: Schema, pkg: SchemaPackage): DmlProcedure[] {
  const covered = new Set(pkg.tableIds);
  return [
    ...(pkg.includeCrud ? schema.tables.filter((table) => covered.has(table.id)).flatMap(tableProcedures) : []),
    ...pkg.procedures.map(customProcedure),
  ];
}

/** `<Name>` of an explicit package: what the user typed, or a numbered stand-in so the script stays valid. */
export const packageDisplayName = (pkg: SchemaPackage, index: number) => normalizeIdentifier(pkg.name.trim() || `Package_${index + 1}`);

/** The spec and body of one package, as the Packages tab previews them. */
export function generatePackage(schema: Schema, pkg: SchemaPackage, index = 0) {
  const name = packageDisplayName(pkg, index);
  const procs = packageProcedures(schema, pkg);
  return { name, spec: packageSpecLines(name, procs).join("\n"), body: packageBodyLines(name, procs, pkg.declarations).join("\n") };
}

/**
 * With no packages defined the schema keeps its one derived `<Prefix>_Dml` body,
 * byte-for-byte as before. Once any exists, only the defined packages are emitted
 * -- each as a spec then a body -- and a table in none of them gets no CRUD.
 */
export function generateDML(schema: Schema) {
  const packages = schema.packages ?? [];
  if (packages.length)
    return packages.map((pkg, index) => { const out = generatePackage(schema, pkg, index); return `${out.spec}\n/\n\n${out.body}\n/`; }).join("\n\n");
  return packageBodyLines(getPackageName(schema), schema.tables.flatMap(tableProcedures)).join("\n");
}

export const generatePLSQL = generateDML;

export function exportSchema(schema: Schema) {
  return `${generateDDL(schema)}\n\n${generateDML(schema)}`;
}

export { generateMermaidER } from "./mermaid";

