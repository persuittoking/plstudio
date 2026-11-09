import { ddlModel, dmlPlan, getPackageName, packageDisplayName } from "./generators";
import { columnKey, resolveQuery, tableIndex, type ResolvedQuery } from "./query-analysis";
import { normalizeIdentifier, type Schema } from "./schema";

/**
 * Everything that depends on one column, before it is renamed or dropped.
 *
 * Constraints, keys and indexes are read off `ddlModel`, so every name here is
 * the one the generated DDL actually created; the PL/SQL answer comes from
 * `dmlPlan`, the same decision `generateDML` prints from.
 *
 * `drop` and `rename` say what each change does to the item. Oracle itself
 * carries a rename through its constraints and indexes, so those break only on
 * a drop -- but text that names the column (a CHECK expression, a package body,
 * a saved query) breaks either way.
 */
export type ImpactKind = "key" | "unique" | "check" | "fk-out" | "fk-in" | "index" | "sequence" | "plsql" | "query";

export type ImpactItem = {
  kind: ImpactKind;
  label: string;
  detail: string;
  tableIds: string[];
  edgeIds: string[];
  /** `tableId:columnId` of the other columns involved. */
  columns: string[];
  drop: boolean;
  rename: boolean;
};

export type ImpactTarget = { tableId: string; columnId: string };

/** Identifiers in an expression, literals first removed -- `'CODE'` names nothing. */
const mentions = (expression: string, name: string) =>
  (expression.replace(/'(?:''|[^'])*'/g, " ").match(/"[^"]+"|[A-Za-z0-9_$#]+/g) ?? [])
    .some((word) => normalizeIdentifier(word.replace(/"/g, "")) === name);

export function columnImpact(schema: Schema, target: ImpactTarget, resolved?: Map<string, ResolvedQuery>): ImpactItem[] {
  const table = schema.tables.find((candidate) => candidate.id === target.tableId);
  const column = table?.columns.find((candidate) => candidate.id === target.columnId);
  if (!table || !column) return [];
  const model = ddlModel(schema);
  const own = model.find((candidate) => candidate.id === table.id);
  const self = columnKey(target);
  const others = (ids: string[], tableId = table.id) => ids.filter((id) => id !== column.id || tableId !== table.id).map((id) => `${tableId}:${id}`);
  const items: ImpactItem[] = [];

  own?.constraints.forEach((constraint) => {
    if (!constraint.columnIds.includes(column.id)) return;
    const columns = `(${constraint.columns.join(", ")})`;
    if (constraint.kind === "pk") items.push({ kind: "key", label: constraint.name, detail: `Primary key ${columns}`, tableIds: [table.id], edgeIds: [], columns: others(constraint.columnIds), drop: true, rename: false });
    if (constraint.kind === "unique") items.push({ kind: "unique", label: constraint.name, detail: `Unique ${columns}`, tableIds: [table.id], edgeIds: [], columns: others(constraint.columnIds), drop: true, rename: false });
    if (constraint.kind === "fk" && constraint.references) {
      const ref = constraint.references;
      items.push({
        kind: "fk-out", label: constraint.name, detail: `References ${ref.table}(${ref.columns.join(", ")})`,
        tableIds: [table.id, ref.tableId], edgeIds: constraint.relationshipId ? [constraint.relationshipId] : [],
        columns: [...others(constraint.columnIds), ...ref.columnIds.map((id) => `${ref.tableId}:${id}`)], drop: true, rename: false,
      });
    }
  });

  // Every CHECK on the table whose text names the column, its own included: the
  // expression is stored as typed, so a rename leaves it pointing at nothing.
  const name = normalizeIdentifier(column.name);
  own?.constraints.forEach((constraint) => {
    if (constraint.kind !== "check" || !mentions(constraint.check ?? "", name)) return;
    items.push({ kind: "check", label: constraint.name, detail: `check (${constraint.check})`, tableIds: [table.id], edgeIds: [], columns: others(constraint.columnIds), drop: true, rename: true });
  });

  model.forEach((other) => other.constraints.forEach((constraint) => {
    const ref = constraint.references;
    if (constraint.kind !== "fk" || !ref || ref.tableId !== table.id || !ref.columnIds.includes(column.id)) return;
    items.push({
      kind: "fk-in", label: constraint.name, detail: `${other.name}(${constraint.columns.join(", ")}) references it`,
      tableIds: [other.id, table.id], edgeIds: constraint.relationshipId ? [constraint.relationshipId] : [],
      columns: constraint.columnIds.map((id) => `${other.id}:${id}`), drop: true, rename: false,
    });
  }));

  own?.indexes.forEach((index) => {
    if (!index.columnIds.includes(column.id)) return;
    items.push({ kind: "index", label: index.name, detail: `Index (${index.columns.join(", ")})`, tableIds: [table.id], edgeIds: [], columns: others(index.columnIds), drop: true, rename: false });
  });

  const identity = own?.columns.find((candidate) => candidate.id === column.id)?.identity;
  if (own?.sequence && column.pk) items.push({ kind: "sequence", label: own.sequence, detail: "Generates this key", tableIds: [table.id], edgeIds: [], columns: [], drop: true, rename: false });
  if (identity) items.push({ kind: "sequence", label: "Identity", detail: "Generated always as identity", tableIds: [table.id], edgeIds: [], columns: [], drop: true, rename: false });

  /* The package names columns explicitly in Upd_/Del_ and in Ins_'s key and
     audit assignments. An insert through `%rowtype` alone recompiles on its own. */
  const plan = dmlPlan(table);
  // Defined packages own the procedures; with none, the derived one does. A table in no package has no PL/SQL to break.
  const owners = schema.packages?.length
    ? schema.packages.flatMap((candidate, index) => (candidate.includeCrud && candidate.tableIds.includes(table.id) ? [packageDisplayName(candidate, index)] : []))
    : [getPackageName(schema)];
  const is = (candidate: { id: string } | undefined) => candidate?.id === column.id;
  const audited = is(plan.modifyOnCol) || is(plan.modifyByCol);
  const insNames = audited || (plan.hasSingleNumberPk && is(plan.pkCols[0]));
  const procedures: [string, boolean][] = [
    [`Ins_${plan.procSuffix}`, insNames],
    ...(plan.isLogTable ? [] : [
      [`Upd_${plan.procSuffix}`, audited || plan.setCols.some(is) || plan.whereCols.some(is)] as [string, boolean],
      [`Del_${plan.procSuffix}`, plan.whereCols.some(is) || (Boolean(plan.stateCol) && (is(plan.stateCol) || audited))] as [string, boolean],
    ]),
  ];
  owners.forEach((pkg) => procedures.forEach(([procedure, names]) => items.push({
    kind: "plsql", label: `${pkg}.${procedure}`,
    detail: names ? "Names this column" : "Inserts through %rowtype",
    tableIds: [table.id], edgeIds: [], columns: [], drop: names, rename: names,
  })));

  const queries = schema.queries ?? [];
  const lookup = resolved ? null : tableIndex(schema);
  queries.forEach((query, index) => {
    const read = resolved?.get(query.id) ?? resolveQuery(query.sql, lookup!);
    if (!read.columns.includes(self)) return;
    items.push({
      kind: "query", label: query.name.trim() || `Query ${index + 1}`, detail: query.sql.replace(/\s+/g, " ").trim(),
      tableIds: read.tableIds, edgeIds: [], columns: read.columns.filter((key) => key !== self), drop: true, rename: true,
    });
  });
  return items;
}

/** What the canvas lights up for a set of items, the target column always among it. */
export function impactHighlight(target: ImpactTarget, items: ImpactItem[]) {
  return {
    tables: new Set([target.tableId, ...items.flatMap((item) => item.tableIds)]),
    edges: new Set(items.flatMap((item) => item.edgeIds)),
    columns: new Set([columnKey(target), ...items.flatMap((item) => item.columns)]),
  };
}
