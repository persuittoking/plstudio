import { keyCovers, normalizeIdentifier, ORACLE_VERSION, primaryKeyColumns, tableKeys, typeUsesSize, type Table, type Schema } from "./schema";

export type ValidationIssue = { severity: "error" | "warning"; message: string; tableId?: string; columnId?: string };

const RESERVED = new Set(["SELECT", "FROM", "WHERE", "TABLE", "USER", "ORDER", "GROUP", "DATE", "NUMBER", "LEVEL", "START", "CONNECT"]);
const IDENTIFIER_LIMIT = 128;

function identifierIssues(value: string, label: string): ValidationIssue[] {
  const normalized = normalizeIdentifier(value);
  const issues: ValidationIssue[] = [];
  if (!value.trim()) issues.push({ severity: "error", message: `${label} cannot be empty.` });
  if (normalized.length > IDENTIFIER_LIMIT) issues.push({ severity: "error", message: `${label} exceeds Oracle ${ORACLE_VERSION} identifier limit of ${IDENTIFIER_LIMIT} bytes.` });
  if (RESERVED.has(normalized)) issues.push({ severity: "error", message: `${label} uses reserved Oracle word ${normalized}.` });
  return issues;
}

function hasBalancedQuotes(expression: string) {
  let quoted = false;
  for (let i = 0; i < expression.length; i += 1) {
    if (expression[i] !== "'") continue;
    if (expression[i + 1] === "'") { i += 1; continue; }
    quoted = !quoted;
  }
  return !quoted;
}

export function validateCheckExpression(expression: string) {
  const value = expression.trim();
  if (!value) return null;
  if (!hasBalancedQuotes(value) || /[;]/.test(value) || /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(value)) {
    return "Check expression is not a supported single Oracle expression.";
  }
  return null;
}

export function validateTypeSpec(type: string, size: string) {
  const value = size.trim();
  if (!typeUsesSize(type as never)) return value ? `${type} does not accept a size or precision.` : null;
  if (!value && ["NUMBER", "FLOAT", "TIMESTAMP"].includes(type)) return null;
  if (!value) return `${type} requires a size or precision.`;
  if (type === "TIMESTAMP") return /^(?:[0-9])$/.test(value) ? null : "TIMESTAMP precision must be an integer from 0 to 9.";
  if (type === "FLOAT") return /^(?:[1-9]|[1-9][0-9]|1[01][0-9]|12[0-6])$/.test(value) ? null : "FLOAT precision must be an integer from 1 to 126.";
  if (type === "NUMBER") {
    const match = value.match(/^(\d{1,2})(?:,(-?\d{1,3}))?$/);
    if (!match || Number(match[1]) > 38) return "NUMBER precision must be 1–38 with an optional scale.";
    const scale = match[2] === undefined ? null : Number(match[2]);
    return scale !== null && (scale < -84 || scale > 127) ? "NUMBER scale must be between -84 and 127." : null;
  }
  return /^\d+$/.test(value) && Number(value) > 0 ? null : `${type} size must be a positive integer.`;
}

function duplicateIssues(items: Array<{ value: string; label: string; tableId?: string; columnId?: string }>) {
  const seen = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  items.forEach((item) => {
    const normalized = normalizeIdentifier(item.value);
    const prior = seen.get(normalized);
    if (prior) issues.push({ severity: "error", message: `${item.label} collides with ${prior} after Oracle normalization.`, tableId: item.tableId, columnId: item.columnId });
    else seen.set(normalized, item.label);
  });
  return issues;
}

export function validateSchema(schema: Schema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Indexed once rather than scanned per foreign key: this runs on every edit,
  // and a linear find per FK column makes validation quadratic in table count.
  const byId = new Map(schema.tables.map((table) => [table.id, table]));
  const columnsById = new Map(
    schema.tables.map((table) => [table.id, new Map(table.columns.map((column) => [column.id, column]))]),
  );
  issues.push(...duplicateIssues(schema.tables.map((table) => ({ value: table.name, label: `table ${table.name}`, tableId: table.id }))));
  issues.push(...duplicateIssues((schema.groups ?? []).map((group) => ({ value: group.name, label: `schema group ${group.name}` }))));
  const packages = schema.packages ?? [];
  issues.push(...duplicateIssues(packages.map((pkg) => ({ value: pkg.name, label: `package ${pkg.name}` }))));
  packages.forEach((pkg) => {
    issues.push(...identifierIssues(pkg.name, `Package ${pkg.name || "(unnamed)"}`));
    pkg.procedures.forEach((proc) => {
      issues.push(...identifierIssues(proc.name, `Subprogram ${proc.name || "(unnamed)"} in ${pkg.name || "(unnamed)"}`));
      if (!proc.body.trim()) issues.push({ severity: "warning", message: `Subprogram ${proc.name || "(unnamed)"} in ${pkg.name || "(unnamed)"} has no body.` });
    });
  });
  (schema.groups ?? []).forEach((group) => {
    issues.push(...identifierIssues(group.name, `Schema group ${group.name}`));
  });
  schema.tables.forEach((table) => {
    issues.push(...identifierIssues(table.name, `Table ${table.name}`));
    issues.push(...duplicateIssues(table.columns.map((column) => ({ value: column.name, label: `column ${table.name}.${column.name}`, tableId: table.id, columnId: column.id }))));
    const pk = primaryKeyColumns(table);
    if (table.keyStrategy !== "none" && !(pk.length === 1 && pk[0].type === "NUMBER")) {
      issues.push({ severity: "warning", message: `${table.name}: generated key strategy requires exactly one numeric PK; use manual key generation.`, tableId: table.id });
    }
    const pkIds = new Set(pk.map((column) => column.id));
    (table.uniques ?? []).forEach((constraint, index) => {
      const label = constraint.name?.trim() || `unique constraint ${index + 1}`;
      if (constraint.name?.trim()) issues.push(...identifierIssues(constraint.name, `Constraint ${table.name}.${constraint.name}`).map((issue) => ({ ...issue, tableId: table.id })));
      // Normalization prunes these; a hand-edited file is the only way in.
      if (!constraint.columnIds.length) issues.push({ severity: "error", message: `${table.name}: ${label} has no columns.`, tableId: table.id });
      else if (constraint.columnIds.length === 1) issues.push({ severity: "warning", message: `${table.name}: ${label} covers one column; use the column's Unique flag instead.`, tableId: table.id });
      else if (constraint.columnIds.length === pkIds.size && constraint.columnIds.every((columnId) => pkIds.has(columnId))) issues.push({ severity: "warning", message: `${table.name}: ${label} repeats the primary key, which already enforces it.`, tableId: table.id });
    });
    /*
     * An index is redundant when another key's columns already start with its
     * own: Oracle can range-scan that key's index on the leading columns alone.
     */
    const keys = tableKeys(table);
    (table.indexes ?? []).forEach((index) => {
      const label = keys.find((key) => key.id === index.id)!.label;
      if (index.name?.trim()) issues.push(...identifierIssues(index.name, `Index ${table.name}.${index.name}`).map((issue) => ({ ...issue, tableId: table.id })));
      if (!index.columnIds.length) return issues.push({ severity: "error", message: `${table.name}: ${label} has no columns.`, tableId: table.id });
      const cover = keys.find((key) => key.id !== index.id && keyCovers(key.columnIds, index.columnIds));
      if (cover) issues.push({ severity: "warning", message: `${table.name}: ${label} is already covered by ${cover.label}.`, tableId: table.id });
    });
    table.columns.forEach((column) => {
      issues.push(...identifierIssues(column.name, `Column ${table.name}.${column.name}`).map((issue) => ({ ...issue, tableId: table.id, columnId: column.id })));
      const checkIssue = validateCheckExpression(column.check);
      if (checkIssue) issues.push({ severity: "error", message: `${table.name}.${column.name}: ${checkIssue}`, tableId: table.id, columnId: column.id });
      const typeIssue = validateTypeSpec(column.type, column.size);
      if (typeIssue) issues.push({ severity: "error", message: `${table.name}.${column.name}: ${typeIssue}`, tableId: table.id, columnId: column.id });
      if (column.fk) {
        const target = byId.get(column.fk.tableId);
        const targetColumn = target && columnsById.get(target.id)?.get(column.fk.columnId);
        if (!target || !targetColumn) issues.push({ severity: "error", message: `${table.name}.${column.name}: foreign key target is missing.`, tableId: table.id, columnId: column.id });
        else if (primaryKeyColumns(target).length > 1) issues.push({ severity: "error", message: `${table.name}.${column.name}: composite-PK targets require FK groups, which are not supported in v1.`, tableId: table.id, columnId: column.id });
        else if (targetColumn.type !== column.type) issues.push({ severity: "error", message: `${table.name}.${column.name}: FK type must match ${target.name}.${targetColumn.name}.`, tableId: table.id, columnId: column.id });
      }
    });
  });
  return issues;
}
