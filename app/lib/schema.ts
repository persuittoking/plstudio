export const ORACLE_VERSION = "12.2+" as const;
export const SCHEMA_FORMAT_VERSION = 11 as const;

export const ORACLE_TYPES = [
  "VARCHAR2",
  "CHAR",
  "NCHAR",
  "NVARCHAR2",
  "NUMBER",
  "FLOAT",
  "BINARY_FLOAT",
  "BINARY_DOUBLE",
  "DATE",
  "TIMESTAMP",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMP WITH LOCAL TIME ZONE",
  "INTERVAL YEAR TO MONTH",
  "INTERVAL DAY TO SECOND",
  "CLOB",
  "NCLOB",
  "BLOB",
  "BFILE",
  "RAW",
] as const;

export type OracleType = (typeof ORACLE_TYPES)[number];
export type KeyStrategy = "none" | "sequence-trigger" | "identity";
/**
 * The database a diagram is designed for. Columns are always stored as Oracle
 * types; a PostgreSQL diagram shows and picks them by their PostgreSQL names
 * (`app/lib/dialect.ts`), so every generator keeps working and both exports stay available.
 */
export type Dialect = "oracle" | "postgres";
export type MemoColor = "yellow" | "blue" | "green" | "pink";
export type GroupColor = "orange" | "blue" | "green" | "purple" | "pink";

export type ForeignKeyRef = { tableId: string; columnId: string };
export type Cardinality = "one_to_one" | "one_to_many" | "many_to_one";
export type RelationshipConstraint = "No action" | "Restrict" | "Cascade" | "Set null" | "Set default";
export type RelationshipFieldPair = { startFieldId: string; endFieldId: string };

export type Relationship = {
  id: string;
  startTableId: string;
  startFieldId: string;
  endTableId: string;
  endFieldId: string;
  fields: RelationshipFieldPair[];
  name: string;
  cardinality: Cardinality;
  manyLabel: string;
  updateConstraint: RelationshipConstraint;
  deleteConstraint: RelationshipConstraint;
};

export type Column = {
  id: string;
  name: string;
  type: OracleType;
  size: string;
  notNull: boolean;
  pk: boolean;
  unique: boolean;
  defaultValue: string;
  check: string;
  comment?: string;
  fk: ForeignKeyRef | null;
  /**
   * A PostgreSQL type picked with no Oracle twin -- `jsonb`, `boolean`, `inet`.
   * `type` keeps the closest Oracle type, so the Oracle DDL stays valid; this
   * counts only while `type` is still the one that choice is stored as
   * (`app/lib/pg-types.ts`). Absent for every other column.
   */
  postgresType?: string;
};

/**
 * Several columns linked into one `unique (a, b)` constraint. `Column.unique`
 * keeps meaning a *single-column* unique and is not set on the members: flagging
 * each one would emit one constraint per column instead of one across them.
 */
export type UniqueConstraint = {
  id: string;
  /** Blank means the generator mints `<table>_u<n>`. */
  name?: string;
  columnIds: string[];
};

/**
 * A plain (non-unique) `create index`. Uniqueness stays with `Column.unique` and
 * `UniqueConstraint`, which already get their index from the constraint.
 */
export type TableIndex = {
  id: string;
  /** Blank means the generator mints `<table>_i<n>`. */
  name?: string;
  columnIds: string[];
};

export type Table = {
  id: string;
  name: string;
  x: number;
  y: number;
  color: { a: string; b: string };
  keyStrategy: KeyStrategy;
  schemaId?: string;
  comment?: string;
  /** Manual width override. Absent means the width is derived from the name. */
  width?: number;
  columns: Column[];
  /** Multi-column unique constraints. Absent and empty mean the same thing. */
  uniques?: UniqueConstraint[];
  /** Non-unique indexes. Absent and empty mean the same thing. */
  indexes?: TableIndex[];
};

export type Memo = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: MemoColor;
  schemaId?: string;
};

export type SchemaGroup = {
  id: string;
  name: string;
  /**
   * Module short code stamped onto the names of tables *created* in this group
   * (`MLL` -> `MLL_LABEL_CODES`). Advisory: it is applied at creation and by the
   * explicit apply action, never enforced afterwards, so a table keeps whatever
   * name the user gives it -- prefixed or not, inside the group or out of it.
   */
  keyword?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: GroupColor;
};

/**
 * One statement kept with the diagram: the heatmap's input, and the snippets
 * impact analysis checks a column against. `executions` weights it, for a
 * statement lifted out of V$SQL or an AWR report with its count.
 */
export type SavedQuery = {
  id: string;
  name: string;
  sql: string;
  executions?: number;
};

/** A column as a template holds it: no id until it lands in a table, and no foreign key to aim. */
export type TemplateColumn = Omit<Column, "id" | "fk">;

/**
 * A reusable run of columns -- the audit block every table repeats. Built-ins
 * live in code (`BUILTIN_COLUMN_TEMPLATES`); the project's own ride in
 * `Schema.columnTemplates`, so collaborators share them.
 */
export type ColumnTemplate = {
  id: string;
  name: string;
  columns: TemplateColumn[];
};

/**
 * A hand-written subprogram kept in a package. `params` is the text between the
 * parentheses and `body` is everything after `is` (declarations, `begin … end;`),
 * both emitted verbatim -- the app never parses them.
 */
export type PackageProcedure = {
  id: string;
  kind: "procedure" | "function";
  name: string;
  params: string;
  /** The return type of a function. Ignored for a procedure. */
  returns?: string;
  body: string;
};

/**
 * An Oracle package: the tables whose `Ins_/Upd_/Del_` procedures it carries
 * (`includeCrud`) and the project's own subprograms. Drawn on the canvas as a
 * card, which is positioned but never sized by hand -- its height follows its rows.
 */
export type SchemaPackage = {
  id: string;
  name: string;
  x: number;
  y: number;
  tableIds: string[];
  includeCrud: boolean;
  /** Package-level state and private helpers, emitted verbatim at the top of the body. */
  declarations?: string;
  procedures: PackageProcedure[];
};

export type Schema = {
  id: string;
  name: string;
  revision: number;
  schemaFormatVersion: number;
  tables: Table[];
  groups?: SchemaGroup[];
  relationships?: Relationship[];
  memos?: Memo[];
  queries?: SavedQuery[];
  /** Absent and empty mean the same thing: the one derived `<Prefix>_Dml` body. */
  packages?: SchemaPackage[];
  /** The project's own column templates. Absent and empty mean the same thing. */
  columnTemplates?: ColumnTemplate[];
  /**
   * The written document behind the Export dialog's Document tab: Markdown with
   * the blocks `app/lib/documentation.ts` adds. Absent and empty mean the same thing.
   */
  documentation?: string;
  /** Absent means Oracle, the database every diagram before this field was made for. */
  dialect?: Dialect;
  /** Project-wide lint settings: the `LINT_RULES` ids turned off. Absent means every rule is on. */
  lint?: { disabled: string[] };
  updatedAt?: string;
};

/**
 * Table accent colours. Rendered as a strip across the top of a card rather
 * than behind text, so these are chosen for separation, not text contrast.
 * One OKLCH lightness (0.66) and chroma (0.15) for all seven, hues spread round
 * the wheel: equal lightness means no table reads heavier than another, and
 * every filled document header takes the same ink. `b` (L 0.58) is retained
 * for stored-schema compatibility.
 */
export const PALETTE = [
  { a: "#00acb6", b: "#00929d" },
  { a: "#2b99e7", b: "#0080cc" },
  { a: "#4ea954", b: "#33903c" },
  { a: "#8a82e9", b: "#736ace" },
  { a: "#cf7b00", b: "#b56300" },
  { a: "#df6862", b: "#c34f4b" },
  { a: "#cd6aaf", b: "#b25196" },
];

/**
 * The palette before it was evened out, by position. Diagrams store the hex,
 * so a table still carrying one of these is moved to the colour now in its
 * slot -- on load and on every read of the shared document -- and the next
 * save writes the new one back.
 */
const LEGACY_PALETTE = ["#175e7a", "#7d9dff", "#3cde7d", "#6360f7", "#f2994a", "#e8617d", "#00b8d9"];

/** The current palette entry for a retired accent; any other colour unchanged. */
export const currentTableColor = (color: Table["color"]): Table["color"] =>
  PALETTE[LEGACY_PALETTE.indexOf(color?.a?.toLowerCase())] ?? color;

export const GROUP_PALETTE: Record<GroupColor, { background: string; border: string; header: string; text: string }> = {
  orange: { background: "#fff4df", border: "#e7a33e", header: "#ffebc5", text: "#8b5b16" },
  blue: { background: "#eaf7fb", border: "#4b9ab3", header: "#d7f0f6", text: "#28677a" },
  green: { background: "#eef8e8", border: "#78ad5b", header: "#e1f2d8", text: "#4b7b36" },
  purple: { background: "#f3effd", border: "#8f79c9", header: "#e9e1fa", text: "#66519d" },
  pink: { background: "#fff0f3", border: "#d98296", header: "#ffe1e8", text: "#9d5062" },
};
export const GROUP_COLORS = Object.keys(GROUP_PALETTE) as GroupColor[];

export const KEY_STRATEGIES: KeyStrategy[] = ["none", "sequence-trigger", "identity"];

/**
 * Ids must be unique across *clients*, not just across a session: two browsers
 * editing one schema would otherwise both mint `tbl_1` and their concurrent
 * inserts would silently merge into a single table. Hence a UUID, not a counter.
 * `randomUUID` is absent outside secure contexts, so fall back to random hex.
 */
export function nextId(prefix: string) {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${unique}`;
}

export function makeColumn(partial: Partial<Column> = {}): Column {
  return {
    id: nextId("col"),
    name: "COLUMN_1",
    type: "VARCHAR2",
    size: "100",
    notNull: false,
    pk: false,
    unique: false,
    defaultValue: "",
    check: "",
    fk: null,
    ...partial,
  };
}

export function makeUniqueConstraint(columnIds: string[] = [], name = ""): UniqueConstraint {
  return { id: nextId("uk"), name: name || undefined, columnIds };
}

export function makeIndex(columnIds: string[] = [], name = ""): TableIndex {
  return { id: nextId("idx"), name: name || undefined, columnIds };
}

/** The columns of `table` that any of its unique constraints names. */
export function uniqueGroupColumnIds(table: Pick<Table, "uniques">) {
  return new Set((table.uniques ?? []).flatMap((constraint) => constraint.columnIds));
}

export function makeTable(name: string, x: number, y: number, colorIndex = 0): Table {
  return {
    id: nextId("tbl"),
    name,
    x,
    y,
    color: PALETTE[colorIndex % PALETTE.length],
    keyStrategy: "sequence-trigger",
    columns: [makeColumn({ name: "ID", type: "NUMBER", size: "", notNull: true, pk: true })],
  };
}

export function makeSchemaGroup(
  name = "New schema",
  x = 80,
  y = 80,
  colorIndex = 0,
): SchemaGroup {
  return {
    id: nextId("group"),
    name,
    x,
    y,
    width: 760,
    height: 520,
    color: GROUP_COLORS[colorIndex % GROUP_COLORS.length],
  };
}

export function makeMemo(
  text = "",
  x = 160,
  y = 120,
  color: MemoColor = "yellow",
): Memo {
  return {
    id: nextId("memo"),
    text,
    x,
    y,
    width: 280,
    height: 170,
    color,
  };
}

const MEMO_COLORS: MemoColor[] = ["yellow", "blue", "green", "pink"];

export function normalizeMemos(value: unknown): Memo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const memo = item as Partial<Memo>;
    if (typeof memo.id !== "string") return [];
    return [{
      id: memo.id,
      text: typeof memo.text === "string" ? memo.text : "",
      x: typeof memo.x === "number" && Number.isFinite(memo.x) ? memo.x : 160,
      y: typeof memo.y === "number" && Number.isFinite(memo.y) ? memo.y : 120,
      width: typeof memo.width === "number" && Number.isFinite(memo.width) ? Math.max(180, memo.width) : 280,
      height: typeof memo.height === "number" && Number.isFinite(memo.height) ? Math.max(100, memo.height) : 170,
      color: MEMO_COLORS.includes(memo.color as MemoColor) ? memo.color as MemoColor : "yellow",
      schemaId: typeof memo.schemaId === "string" && memo.schemaId ? memo.schemaId : undefined,
    }];
  });
}

export function makeSavedQuery(sql = "", name = "", executions?: number): SavedQuery {
  return { id: nextId("query"), name, sql, executions };
}

export function normalizeQueries(value: unknown): SavedQuery[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const query = item as Partial<SavedQuery>;
    if (typeof query.id !== "string" || !query.id || typeof query.sql !== "string") return [];
    const executions = typeof query.executions === "number" && Number.isFinite(query.executions) && query.executions > 0 ? Math.round(query.executions) : undefined;
    return [{ id: query.id, name: typeof query.name === "string" ? query.name : "", sql: query.sql, executions }];
  });
}

export const PACKAGE_WIDTH = 260;
export const PACKAGE_HEADER_HEIGHT = 36;
export const PACKAGE_ROW_HEIGHT = 24;

/** One row per covered table (when `includeCrud`) and per subprogram; an empty package still shows one hint row. */
export const packageRowCount = (pkg: SchemaPackage) => (pkg.includeCrud ? pkg.tableIds.length : 0) + pkg.procedures.length;
export const packageHeight = (pkg: SchemaPackage) => PACKAGE_HEADER_HEIGHT + Math.max(1, packageRowCount(pkg)) * PACKAGE_ROW_HEIGHT + 8;

export const makePackage =(name = "", x = 160, y = 120): SchemaPackage => ({
  id: nextId("package"), name, x, y, tableIds: [], includeCrud: true, procedures: [],
});

export const makePackageProcedure = (kind: PackageProcedure["kind"] = "procedure"): PackageProcedure => ({
  id: nextId("proc"), kind, name: "", params: "", returns: kind === "function" ? "varchar2" : undefined, body: "begin\n  null;\nend;",
});

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Tolerates junk, and prunes `tableIds` to the tables that exist so a deleted table just leaves its package. */
export function normalizePackages(value: unknown, tableIds?: Iterable<string>): SchemaPackage[] {
  if (!Array.isArray(value)) return [];
  const live = tableIds ? new Set(tableIds) : undefined;
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const pkg = item as Partial<SchemaPackage>;
    if (typeof pkg.id !== "string" || !pkg.id || seen.has(pkg.id)) return [];
    seen.add(pkg.id);
    const procedures = (Array.isArray(pkg.procedures) ? pkg.procedures : []).flatMap((proc): PackageProcedure[] => {
      if (!proc || typeof proc !== "object" || typeof proc.id !== "string" || !proc.id) return [];
      const kind = proc.kind === "function" ? "function" : "procedure";
      return [{ id: proc.id, kind, name: str(proc.name), params: str(proc.params), returns: kind === "function" ? str(proc.returns, "varchar2") : undefined, body: str(proc.body) }];
    });
    const ids = (Array.isArray(pkg.tableIds) ? pkg.tableIds : []).filter((id): id is string => typeof id === "string" && (!live || live.has(id)));
    return [{ id: pkg.id, name: str(pkg.name), x: Math.max(0, num(pkg.x, 160)), y: Math.max(0, num(pkg.y, 120)), tableIds: [...new Set(ids)], includeCrud: pkg.includeCrud !== false, declarations: str(pkg.declarations) || undefined, procedures }];
  });
}

/** `schema` itself when every package already points only at live tables, so an ordinary commit stays identity-stable. */
export function prunePackages(schema: Schema): Schema {
  if (!schema.packages?.length) return schema;
  const live = new Set(schema.tables.map((table) => table.id));
  if (schema.packages.every((pkg) => pkg.tableIds.every((id) => live.has(id)))) return schema;
  return { ...schema, packages: schema.packages.map((pkg) => ({ ...pkg, tableIds: pkg.tableIds.filter((id) => live.has(id)) })) };
}

const templateColumn = (partial: Partial<TemplateColumn> & Pick<TemplateColumn, "name" | "type">): TemplateColumn => ({
  size: "", notNull: false, pk: false, unique: false, defaultValue: "", check: "", ...partial,
});

/** Shipped with the app and never stored, so their ids only have to be unique among themselves. */
export const BUILTIN_COLUMN_TEMPLATES: ColumnTemplate[] = [
  {
    id: "builtin_audit",
    name: "Audit columns",
    columns: [
      templateColumn({ name: "CREATED_AT", type: "TIMESTAMP", notNull: true, defaultValue: "SYSTIMESTAMP" }),
      templateColumn({ name: "CREATED_BY", type: "VARCHAR2", size: "128", notNull: true, defaultValue: "USER" }),
      templateColumn({ name: "UPDATED_AT", type: "TIMESTAMP" }),
      templateColumn({ name: "UPDATED_BY", type: "VARCHAR2", size: "128" }),
    ],
  },
  {
    id: "builtin_soft_delete",
    name: "Soft delete",
    columns: [
      templateColumn({ name: "IS_DELETED", type: "NUMBER", size: "1", notNull: true, defaultValue: "0", check: "IS_DELETED IN (0, 1)" }),
      templateColumn({ name: "DELETED_AT", type: "TIMESTAMP" }),
    ],
  },
  {
    id: "builtin_row_version",
    name: "Row version",
    columns: [templateColumn({ name: "ROW_VERSION", type: "NUMBER", notNull: true, defaultValue: "0" })],
  },
];

/** Columns as a template keeps them. The foreign key goes: its target is one table in one project. */
export const toTemplateColumns = (columns: Column[]): TemplateColumn[] =>
  columns.map(({ id: _id, fk: _fk, ...rest }) => rest);

export function makeColumnTemplate(name: string, columns: Column[]): ColumnTemplate {
  return { id: nextId("tpl"), name, columns: toTemplateColumns(columns) };
}

/**
 * The template's columns appended to `table`, each with a fresh id. A column
 * whose name the table already carries -- compared as Oracle will, normalized --
 * is skipped, so applying a template twice adds nothing the second time.
 */
export function applyColumnTemplate(table: Table, template: ColumnTemplate): Table {
  const taken = new Set(table.columns.map((column) => normalizeIdentifier(column.name)));
  const added = template.columns.filter((column) => !taken.has(normalizeIdentifier(column.name))).map((column) => makeColumn({ ...column, fk: null }));
  return added.length ? { ...table, columns: [...table.columns, ...added] } : table;
}

export function normalizeColumnTemplates(value: unknown): ColumnTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const template = item as Partial<ColumnTemplate>;
    if (typeof template.id !== "string" || !template.id || !Array.isArray(template.columns)) return [];
    const columns = template.columns.flatMap((raw) => {
      const column = raw as Partial<TemplateColumn> | null;
      if (!column || typeof column.name !== "string" || !column.name.trim() || !ORACLE_TYPES.includes(column.type as OracleType)) return [];
      const text = (key: "size" | "defaultValue" | "check") => (typeof column[key] === "string" ? column[key] : "");
      return [{
        ...templateColumn({ name: column.name, type: column.type as OracleType, size: text("size"), defaultValue: text("defaultValue"), check: text("check") }),
        notNull: column.notNull === true,
        pk: column.pk === true,
        unique: column.unique === true,
        ...(typeof column.comment === "string" && column.comment ? { comment: column.comment } : {}),
        ...(typeof column.postgresType === "string" && column.postgresType ? { postgresType: column.postgresType } : {}),
      }];
    });
    return columns.length ? [{ id: template.id, name: typeof template.name === "string" && template.name.trim() ? template.name : "Untitled template", columns }] : [];
  });
}

export function makeDemoSchema(): Schema {
  const student = makeTable("STUDENT", 80, 90, 0);
  const enrollment = makeTable("ENROLLMENT", 460, 270, 1);
  enrollment.columns = [
    makeColumn({ name: "STUDENT_ID", type: "NUMBER", size: "", notNull: true, fk: { tableId: student.id, columnId: student.columns[0].id } }),
    makeColumn({ name: "COURSE_CODE", type: "VARCHAR2", size: "20", notNull: true }),
    makeColumn({ name: "STATUS", type: "CHAR", size: "1", notNull: true, defaultValue: "'A'", check: "STATUS IN ('A', 'I')" }),
    makeColumn({ name: "ENROLLED_ON", type: "DATE", size: "", notNull: true, defaultValue: "SYSDATE" }),
  ];
  enrollment.keyStrategy = "none";
  return {
    id: nextId("schema"),
    name: "Oracle PL/SQL Workspace",
    revision: 1,
    schemaFormatVersion: SCHEMA_FORMAT_VERSION,
    tables: [student, enrollment],
    groups: [],
    relationships: [],
    memos: [],
    queries: [],
    packages: [],
    columnTemplates: [],
  };
}

export function makeEmptySchema(name = "Untitled Diagram", id = nextId("schema"), dialect: Dialect = "oracle"): Schema {
  return {
    id,
    name,
    ...(dialect === "postgres" ? { dialect } : {}),
    revision: 1,
    schemaFormatVersion: SCHEMA_FORMAT_VERSION,
    tables: [],
    groups: [],
    relationships: [],
    memos: [],
    queries: [],
    packages: [],
    columnTemplates: [],
  };
}

/** `{ lint }` when `value` turns any rule off, else nothing -- absent and empty mean the same, as with `documentation`. */
export function normalizeLint(value: unknown): Pick<Schema, "lint"> {
  const raw = value && typeof value === "object" ? (value as { disabled?: unknown }).disabled : undefined;
  const disabled = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string"))] : [];
  return disabled.length ? { lint: { disabled } } : {};
}

export function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_$#]/g, "_").replace(/^([0-9])/, "T_$1");
}

/**
 * The `MLL_` a group stamps onto its tables, or `""` when it has no usable
 * keyword. Normalized here rather than at edit time, per the convention that
 * users type freely and Oracle's rules apply on the way out -- so `mll` and
 * `MLL` agree, and a keyword of nothing but punctuation degrades to no prefix
 * rather than to a bare `_`.
 */
export function groupPrefix(group?: Pick<SchemaGroup, "keyword">) {
  const keyword = normalizeIdentifier(group?.keyword ?? "").replace(/_+$/, "");
  return keyword ? `${keyword}_` : "";
}

/**
 * Whether `name` already opens with `prefix`, compared case- and
 * separator-insensitively. Deliberately not `normalizeIdentifier`: its
 * digit-leading `T_` rule grows the string, and a prefix of `T_` would then
 * match `1ABC` and slice two characters out of the middle of it.
 */
function carriesPrefix(name: string, prefix: string) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9_$#]/g, "_").startsWith(prefix);
}

/**
 * Idempotent: a name already carrying the prefix comes back untouched, so the
 * apply action can be re-run and a name built from prefixed parts never doubles
 * up. `mll_x` already carries `MLL_`.
 */
export function prefixTableName(name: string, prefix: string) {
  if (!prefix) return name;
  return carriesPrefix(name, prefix) ? name.trim() : `${prefix}${name.trim()}`;
}

/** Inverse of `prefixTableName`; a no-op on a name that does not carry the prefix. */
export function stripTablePrefix(name: string, prefix: string) {
  return prefix && carriesPrefix(name, prefix) ? name.trim().slice(prefix.length) : name;
}

export function typeString(column: Column) {
  if (typeUsesSize(column.type) && column.size) return `${column.type}(${column.size})`;
  return column.type;
}

export function typeUsesSize(type: OracleType) {
  return ["VARCHAR2", "CHAR", "NCHAR", "NVARCHAR2", "NUMBER", "FLOAT", "TIMESTAMP", "RAW"].includes(type);
}

export function typeSizePlaceholder(type: OracleType) {
  if (["NUMBER"].includes(type)) return "precision[,scale]";
  if (["TIMESTAMP"].includes(type)) return "precision 0–9";
  if (["FLOAT"].includes(type)) return "precision 1–126";
  return "size";
}

export function isNumeric(column: Column) {
  return column.type === "NUMBER";
}

export function primaryKeyColumns(table: Table) {
  return table.columns.filter((column) => column.pk);
}

/**
 * Every index Oracle will have on `table`, in column order: the primary key's,
 * each unique's, and the plain ones. What an index suggestion or a redundancy
 * warning checks a column list against -- a key covers any list it starts with.
 */
export function tableKeys(table: Table) {
  const pk = primaryKeyColumns(table).map((column) => column.id);
  return [
    ...(pk.length ? [{ id: "pk", label: "the primary key", columnIds: pk }] : []),
    ...table.columns.filter((column) => column.unique).map((column) => ({ id: column.id, label: `unique ${column.name}`, columnIds: [column.id] })),
    ...(table.uniques ?? []).map((constraint, index) => ({ id: constraint.id, label: constraint.name?.trim() || `unique constraint ${index + 1}`, columnIds: constraint.columnIds })),
    ...(table.indexes ?? []).map((index, position) => ({ id: index.id, label: index.name?.trim() || `index ${position + 1}`, columnIds: index.columnIds })),
  ];
}

/** Whether `key` starts with `columnIds`, so its index serves a lookup on them. */
export const keyCovers = (key: string[], columnIds: string[]) =>
  key.length >= columnIds.length && columnIds.every((id, at) => key[at] === id);

/**
 * Card geometry. Mirrored by the same constants in Designer.tsx — relationship
 * anchor routing depends on the two agreeing, so change them together.
 */
export const TABLE_WIDTH = 220;
export const TABLE_MIN_WIDTH = 180;
/** Ceiling for both the content-derived width and a manual resize; past it, names ellipsize. */
export const TABLE_MAX_WIDTH = 640;
export const TABLE_COLOR_STRIP_HEIGHT = 7;
export const TABLE_HEADER_HEIGHT = 50;
export const TABLE_FIELD_HEIGHT = 36;

export function clampTableWidth(width: number) {
  return Math.max(TABLE_MIN_WIDTH, Math.min(TABLE_MAX_WIDTH, Math.round(width)));
}

/*
 * Geist's advance widths at weight 700, in hundredths of an em, measured in
 * Chrome against the font the app ships. Bold is the widest weight a card
 * draws, so a name this fits never truncates at a lighter one. Anything not
 * listed (accents, other scripts) is costed as a wide capital.
 */
const SANS_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$#";
const SANS_ADVANCES = [
  73, 70, 73, 72, 62, 60, 74, 72, 30, 63, 69, 59, 91, 75, 78, 67, 77, 70, 68, 60, 70, 73, 101, 69, 63, 59,
  59, 63, 60, 63, 61, 45, 63, 61, 28, 33, 65, 31, 90, 61, 62, 63, 63, 42, 57, 44, 61, 61, 85, 65, 59, 58,
  69, 45, 65, 65, 66, 67, 63, 54, 66, 63, 56, 67, 59,
];
const SANS_ADVANCE = new Map([...SANS_GLYPHS].map((glyph, index) => [glyph, SANS_ADVANCES[index]]));
const sansWidth = (text: string, size: number) =>
  ([...text].reduce((sum, glyph) => sum + (SANS_ADVANCE.get(glyph) ?? 80), 0) * size) / 100;
/** JetBrains Mono advances a fixed 0.6em; `tracking` is the CSS letter-spacing in em. */
const monoWidth = (text: string, size: number, tracking = 0) => text.length * size * (0.6 + tracking);

/*
 * What a card spends around its text, in px, from the rules in globals.css: a
 * 2px border each side, then for the header 12px padding each side and an 8px
 * gap before the key-strategy tag (10px mono, 0.06em tracking); for a row 8px
 * padding each side, the 10px link grip, 8px gaps, a meta cluster of 13px icons
 * at 5px gaps, the nullable slot (1ch at 12px less its -4px margin) and the
 * 22px reorder grip -- reserved even where it is hidden, so a card does not
 * change width when it becomes editable. A document row swaps the icons for
 * the 24px key badge and sets the name in 11.5px mono, lower-cased.
 */
const CARD_BORDERS = 4;
const HEADER_CHROME = CARD_BORDERS + 2 * 12 + 8;
const ROW_CHROME = CARD_BORDERS + 2 * 8 + 10 + 8 + 8 + 5 + (12 * 0.6 - 4) + 5 + 22;
const DOCUMENT_ROW_CHROME = ROW_CHROME + 24 + 8;
const ROW_ICON = 13 + 5;
/** Sub-pixel kerning and rounding the estimate does not model. */
const FIT_SLACK = 4;

export const keyStrategyTag = (strategy: KeyStrategy | undefined) =>
  strategy === "sequence-trigger" ? "SEQ+TRG" : strategy === "identity" ? "IDENTITY" : "";

type WidthInput = Pick<Table, "name"> & Partial<Pick<Table, "width" | "columns" | "keyStrategy" | "uniques">>;

/**
 * The width at which nothing on the card truncates -- the header and every row,
 * in whichever card style is wider -- capped at `TABLE_MAX_WIDTH`. Estimated
 * from font metrics rather than measured from the DOM, for the reason
 * `commentLines` is: the canvas, the export and the relationship anchors all
 * have to agree on it, and only one of them has a DOM.
 */
function contentWidth(table: WidthInput) {
  const tag = monoWidth(keyStrategyTag(table.keyStrategy), 10, 0.06);
  const grouped = uniqueGroupColumnIds(table);
  const header = HEADER_CHROME + tag + Math.max(sansWidth(table.name.trim().toUpperCase(), 16), sansWidth(table.name.trim().toLowerCase(), 14));
  const rows = (table.columns ?? []).map((column) => {
    const icons = [column.pk, column.fk, (column.unique || grouped.has(column.id)) && !column.pk].filter(Boolean).length;
    // Room for the type under either database's name: PostgreSQL's `double precision` is the one longer than Oracle's.
    const type = Math.max(
      monoWidth(column.type === "BINARY_DOUBLE" || column.type === "FLOAT" ? "double precision" : typeString(column), 12),
      monoWidth(column.postgresType ? `${column.postgresType}(${column.size})` : "", 12),
    );
    return Math.max(
      ROW_CHROME + sansWidth(column.name.toUpperCase(), 14) + icons * ROW_ICON + type,
      DOCUMENT_ROW_CHROME + monoWidth(column.name, 11.5) + type,
    );
  });
  return Math.min(TABLE_MAX_WIDTH, Math.ceil(Math.max(header, ...rows) + FIT_SLACK));
}

/*
 * `tableWidth` runs per table per frame in the gesture layer, so the fit is
 * cached on the table object and kept while the fields it reads are the same
 * references -- which every immutable edit, and every stable Y.Doc read, keeps.
 */
const widthCache = new WeakMap<object, { name: string; keyStrategy?: KeyStrategy; columns?: Column[]; uniques?: UniqueConstraint[]; width: number }>();
function fittedWidth(table: WidthInput) {
  const cached = widthCache.get(table);
  if (cached && cached.name === table.name && cached.keyStrategy === table.keyStrategy && cached.columns === table.columns && cached.uniques === table.uniques)
    return cached.width;
  const width = contentWidth(table);
  widthCache.set(table, { name: table.name, keyStrategy: table.keyStrategy, columns: table.columns, uniques: table.uniques, width });
  return width;
}

/** The narrowest a resize may take the card: its content, or the global minimum. */
export const tableMinWidth = (table: WidthInput) => Math.max(TABLE_MIN_WIDTH, fittedWidth(table));

/**
 * Wide enough for the content, never narrower than the default. A manual width
 * may go wider, but the content is a floor under it too: a resize can add room,
 * never cut a name off.
 */
export function tableWidth(table: WidthInput) {
  const fit = fittedWidth(table);
  return typeof table.width === "number" && Number.isFinite(table.width)
    ? clampTableWidth(Math.max(table.width, fit))
    : Math.max(TABLE_WIDTH, fit);
}

/**
 * How a card is drawn. `classic` is the colour strip over a white header;
 * `document` fills the header with the table colour and shows the table
 * comment in a block beneath it, the way a printed ERD does. The export always
 * draws `document`; the canvas draws whichever the user picked.
 */
export type CardStyle = "classic" | "document";
export const CARD_STYLES: CardStyle[] = ["classic", "document"];

export const DOCUMENT_HEADER_HEIGHT = 40;
export const COMMENT_LINE_HEIGHT = 16;
export const COMMENT_PADDING = 10;
export const COMMENT_MAX_LINES = 3;
/** Rough advance of a 12px sans glyph -- the comment's wrap width, shared by canvas and export. */
export const COMMENT_CHAR_WIDTH = 6.4;

/**
 * Greedy word wrap to `maxChars` a line. A word longer than a line is broken
 * across lines rather than lost; a blank line in the source stays blank.
 */
export function wrapText(text: string, maxChars: number) {
  const max = Math.max(1, Math.floor(maxChars));
  return text.split("\n").flatMap((paragraph) =>
    paragraph.split(/\s+/).filter(Boolean).reduce<string[]>((lines, word) => {
      (word.match(new RegExp(`.{1,${max}}`, "g")) ?? [word]).forEach((piece) => {
        const last = lines[lines.length - 1];
        if (last !== undefined && last.length + 1 + piece.length <= max) lines[lines.length - 1] = `${last} ${piece}`;
        else lines.push(piece);
      });
      return lines;
    }, []).concat(paragraph.trim() ? [] : [""]),
  );
}

/**
 * The comment as a document card shows it: wrapped to the card, at most
 * `COMMENT_MAX_LINES`, the last one marked when there was more. Computed here,
 * not measured in the DOM, so the canvas and the export agree on every card's
 * height -- relationship anchors are derived from it.
 */
export function commentLines(table: WidthInput & Pick<Table, "comment">) {
  const comment = table.comment?.trim();
  if (!comment) return [];
  const max = Math.floor((tableWidth(table) - 2 * 12) / COMMENT_CHAR_WIDTH);
  const lines = wrapText(comment, max);
  if (lines.length <= COMMENT_MAX_LINES) return lines;
  const last = lines[COMMENT_MAX_LINES - 1];
  return [...lines.slice(0, COMMENT_MAX_LINES - 1), `${last.length >= max ? last.slice(0, max - 1) : last}…`];
}

/**
 * Near-black or white, whichever reads on `hex` (relative luminance, WCAG
 * weights): the palette runs from navy to mint, and a filled header has to
 * carry its name on all of them.
 */
export function inkOn(hex: string) {
  const match = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return "#ffffff";
  const [r, g, b] = [0, 2, 4]
    .map((at) => parseInt(match[1].slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0f172a" : "#ffffff";
}

/** Top of the card to the first row: where relationship anchors start counting. */
export function tableHeaderHeight(table: Table, style: CardStyle = "classic") {
  if (style === "classic") return TABLE_COLOR_STRIP_HEIGHT + TABLE_HEADER_HEIGHT;
  const lines = commentLines(table).length;
  return DOCUMENT_HEADER_HEIGHT + (lines ? lines * COMMENT_LINE_HEIGHT + 2 * COMMENT_PADDING : 0);
}

export function tableHeight(table: Table, style: CardStyle = "classic") {
  return tableHeaderHeight(table, style) + table.columns.length * TABLE_FIELD_HEIGHT;
}

/** Clear of everything already on the canvas, so an import never lands on top of it. */
export const APPEND_GAP = 120;

/** Left and bottom of everything drawn, or `null` for an empty canvas. */
export function contentEdges(schema: Schema) {
  const boxes = [
    ...schema.tables.map((table) => ({ x: table.x, y: table.y + tableHeight(table) })),
    ...(schema.groups ?? []).map((group) => ({ x: group.x, y: group.y + group.height })),
    ...(schema.memos ?? []).map((memo) => ({ x: memo.x, y: memo.y + memo.height })),
  ];
  return boxes.length ? { left: Math.min(...boxes.map((box) => box.x)), bottom: Math.max(...boxes.map((box) => box.y)) } : null;
}

/**
 * Prune column sets -- unique constraints and indexes alike -- against the
 * columns that actually exist. A member column being deleted has to shrink its
 * set rather than break it, so a missing id is dropped silently and a set left
 * with nothing is dropped whole. Repeated column sets collapse -- Oracle would
 * reject the second index.
 */
function normalizeColumnSets<T extends UniqueConstraint | TableIndex>(table: Table, value: T[] | undefined): T[] | undefined {
  const columnIds = new Set(table.columns.map((column) => column.id));
  const sets = new Set<string>();
  const kept = (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const set = item as Partial<T>;
    if (typeof set.id !== "string" || !set.id) return [];
    const members = [...new Set((Array.isArray(set.columnIds) ? set.columnIds : []).filter((id) => typeof id === "string" && columnIds.has(id)))];
    if (!members.length) return [];
    // Order is the DDL's, so the key is order-sensitive on purpose: `(a, b)`
    // and `(b, a)` index the same rows but read differently to the user.
    const key = members.join(" ");
    if (sets.has(key)) return [];
    sets.add(key);
    const name = typeof set.name === "string" ? set.name.trim() : "";
    return [{ id: set.id, name: name || undefined, columnIds: members } as T];
  });
  return kept.length ? kept : undefined;
}

/**
 * Drop garbage manual widths (nulls, NaN, values from a future version) and
 * clamp the survivors, so a bad `width` degrades to auto rather than to a
 * zero-width card. Unique constraints and indexes are pruned against the
 * surviving columns in the same pass.
 */
export function normalizeTables(schema: Schema): Schema {
  const next = cloneSchema(schema);
  next.tables = next.tables.map((table) => {
    const width = (table as Partial<Table>).width;
    /*
     * A size left over from an earlier type is not just noise: DATE(255) is a
     * validation error and reads as a real limit on the card. The editor drops
     * it on the way in, but schemas written before it did still carry one.
     */
    const columns = table.columns.map((column) =>
      column.size && !typeUsesSize(column.type) ? { ...column, size: "" } : column,
    );
    const uniques = normalizeColumnSets(table, table.uniques);
    const indexes = normalizeColumnSets(table, table.indexes);
    const color = currentTableColor(table.color);
    if (width === undefined) return { ...table, color, columns, uniques, indexes };
    return typeof width === "number" && Number.isFinite(width)
      ? { ...table, color, columns, uniques, indexes, width: clampTableWidth(width) }
      : { ...table, color, columns, uniques, indexes, width: undefined };
  });
  return next;
}

export function cloneSchema(schema: Schema): Schema {
  return structuredClone(schema);
}

/**
 * `owned` skips the defensive clone, for a caller passing a schema it has just
 * cloned itself -- `generateDDL` normalizes relationships first, and a second
 * `structuredClone` of the result was a third of its time on a large diagram.
 */
export function normalizeGroups(schema: Schema, owned = false): Schema {
  const next = owned ? schema : cloneSchema(schema);
  const groups = Array.isArray(next.groups) ? next.groups : [];
  const seen = new Set<string>();
  next.groups = groups.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const group = value as Partial<SchemaGroup>;
    if (typeof group.id !== "string" || !group.id || seen.has(group.id)) return [];
    seen.add(group.id);
    return [{
      id: group.id,
      name: typeof group.name === "string" && group.name.trim() ? group.name.trim() : `Schema ${index + 1}`,
      keyword: typeof group.keyword === "string" && group.keyword.trim() ? group.keyword.trim() : undefined,
      x: typeof group.x === "number" && Number.isFinite(group.x) ? Math.max(0, group.x) : 80,
      y: typeof group.y === "number" && Number.isFinite(group.y) ? Math.max(0, group.y) : 80,
      width: typeof group.width === "number" && Number.isFinite(group.width) ? Math.max(360, group.width) : 760,
      height: typeof group.height === "number" && Number.isFinite(group.height) ? Math.max(260, group.height) : 520,
      color: GROUP_COLORS.includes(group.color as GroupColor) ? group.color as GroupColor : GROUP_COLORS[index % GROUP_COLORS.length],
    }];
  });
  const valid = new Set(next.groups.map((group) => group.id));
  next.tables = next.tables.map((table) => valid.has(table.schemaId ?? "")
    ? table
    : { ...table, schemaId: undefined });
  next.memos = next.memos?.map((memo) => valid.has(memo.schemaId ?? "")
    ? memo
    : { ...memo, schemaId: undefined });
  next.schemaFormatVersion = SCHEMA_FORMAT_VERSION;
  return next;
}

/** Everything that rides along with a schema group when it is relocated. */
export function groupMembers(schema: Schema, groupId: string) {
  return {
    tables: schema.tables.filter((table) => table.schemaId === groupId),
    memos: (schema.memos ?? []).filter((memo) => memo.schemaId === groupId),
  };
}

export const RELATIONSHIP_CONSTRAINTS: RelationshipConstraint[] = [
  "No action",
  "Restrict",
  "Cascade",
  "Set null",
  "Set default",
];

function relationshipName(tables: Table[], startTableId: string, startFieldId: string, endTableId: string) {
  const start = tables.find((table) => table.id === startTableId);
  const field = start?.columns.find((column) => column.id === startFieldId);
  const end = tables.find((table) => table.id === endTableId);
  return `fk_${start?.name ?? "table"}_${field?.name ?? "field"}_${end?.name ?? "table"}`;
}

function isCardinality(value: unknown): value is Cardinality {
  return value === "one_to_one" || value === "one_to_many" || value === "many_to_one";
}

function isConstraint(value: unknown): value is RelationshipConstraint {
  return RELATIONSHIP_CONSTRAINTS.includes(value as RelationshipConstraint);
}

/** Normalize persisted relationship data and migrate the original column.fk format. */
export function normalizeRelationships(schema: Schema): Schema {
  const next = cloneSchema(schema);
  const raw = Array.isArray(next.relationships) ? next.relationships : [];
  const relationships: Relationship[] = [];
  const used = new Set<string>();

  // First match wins, as `find` did: a duplicated id must not change which table a key binds to.
  const tablesById = new Map<string, Table>();
  next.tables.forEach((table) => { if (!tablesById.has(table.id)) tablesById.set(table.id, table); });

  const add = (value: Partial<Relationship>, fallbackId: string) => {
    const startTable = tablesById.get(value.startTableId ?? "");
    const endTable = tablesById.get(value.endTableId ?? "");
    const startField = startTable?.columns.find((column) => column.id === value.startFieldId);
    const endField = endTable?.columns.find((column) => column.id === value.endFieldId);
    if (!startTable || !endTable || !startField || !endField) return;
    const pairs = Array.isArray(value.fields) && value.fields.length
      ? value.fields.filter((pair): pair is RelationshipFieldPair => Boolean(pair?.startFieldId && pair?.endFieldId))
      : [{ startFieldId: startField.id, endFieldId: endField.id }];
    const validPairs = pairs.filter((pair) => startTable.columns.some((column) => column.id === pair.startFieldId) && endTable.columns.some((column) => column.id === pair.endFieldId));
    if (!validPairs.length) return;
    const id = typeof value.id === "string" && value.id ? value.id : fallbackId;
    if (used.has(id)) return;
    used.add(id);
    relationships.push({
      id,
      startTableId: startTable.id,
      startFieldId: validPairs[0].startFieldId,
      endTableId: endTable.id,
      endFieldId: validPairs[0].endFieldId,
      fields: validPairs,
      name: typeof value.name === "string" && value.name ? value.name : relationshipName(next.tables, startTable.id, validPairs[0].startFieldId, endTable.id),
      cardinality: isCardinality(value.cardinality) ? value.cardinality : "many_to_one",
      manyLabel: typeof value.manyLabel === "string" ? value.manyLabel : "n",
      updateConstraint: isConstraint(value.updateConstraint) ? value.updateConstraint : "No action",
      deleteConstraint: isConstraint(value.deleteConstraint) ? value.deleteConstraint : "No action",
    });
  };

  raw.forEach((relationship, index) => add(relationship, `rel_${index + 1}`));
  if (!raw.length) {
    next.tables.forEach((table) => table.columns.forEach((column) => {
      if (!column.fk) return;
      add({
        id: `rel_${relationships.length + 1}`,
        startTableId: table.id,
        startFieldId: column.id,
        endTableId: column.fk.tableId,
        endFieldId: column.fk.columnId,
      }, `rel_${relationships.length + 1}`);
    }));
  }

  /*
   * One pass, not one rebuild of every table per key pair: that was
   * O(relationships x tables) allocations and dominated `generateDDL` on large
   * diagrams. Later relationships still overwrite earlier ones on the same column.
   */
  const fkByColumn = new Map<string, ForeignKeyRef>();
  relationships.forEach((relationship) => relationship.fields.forEach((pair) =>
    fkByColumn.set(`${relationship.startTableId}\u0000${pair.startFieldId}`, { tableId: relationship.endTableId, columnId: pair.endFieldId })));
  next.tables = next.tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => ({ ...column, fk: fkByColumn.get(`${table.id}\u0000${column.id}`) ?? null })),
  }));
  next.relationships = relationships;
  next.schemaFormatVersion = SCHEMA_FORMAT_VERSION;
  return next;
}
