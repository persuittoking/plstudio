import { describe, expect, it } from "vitest";
import { choiceOf, convertToOracle, convertToPostgres, dialectOf, PG_TYPE_OPTIONS, pgOptionOf, pgTypePatch, toPostgresColumn, typeName } from "@/app/lib/dialect";
import { generateDDL } from "@/app/lib/generators";
import { generatePostgres } from "@/app/lib/postgres";
import { exportSchemaJson, parseSchemaJson } from "@/app/lib/schema-json";
import { makeColumn, makeEmptySchema, makeTable, type Column, type Schema } from "@/app/lib/schema";

const col = (type: Column["type"], size = "", extra: Partial<Column> = {}) => makeColumn({ type, size, ...extra });

describe("dialect", () => {
  it("reads absent as Oracle", () => {
    expect(dialectOf(makeEmptySchema())).toBe("oracle");
    expect(dialectOf(makeEmptySchema("x", "id", "postgres"))).toBe("postgres");
    expect(makeEmptySchema().dialect).toBeUndefined();
  });

  it("names types in the diagram's database", () => {
    expect(typeName(col("VARCHAR2", "100"), "oracle")).toBe("VARCHAR2(100)");
    expect(typeName(col("VARCHAR2", "100"), "postgres")).toBe("varchar(100)");
    expect(typeName(col("NUMBER", "19"), "postgres")).toBe("bigint");
    expect(typeName(col("NUMBER", "10"), "postgres")).toBe("integer");
    expect(typeName(col("NUMBER", "12,2"), "postgres")).toBe("numeric(12,2)");
    expect(typeName(col("NUMBER", "7"), "postgres")).toBe("numeric(7)");
    expect(typeName(col("DATE"), "postgres")).toBe("date");
    expect(typeName(col("RAW", "16"), "postgres")).toBe("uuid");
    expect(typeName(col("CLOB"), "postgres")).toBe("text");
    expect(typeName(col("BINARY_DOUBLE"), "postgres")).toBe("double precision");
  });

  it("every picker choice stores a type it is shown as again", () => {
    for (const option of PG_TYPE_OPTIONS) {
      const stored = pgTypePatch(option.id, col("VARCHAR2", "100"));
      expect(pgOptionOf(stored).id).toBe(option.id);
      expect(choiceOf(stored, "postgres")).toBe(option.id);
    }
  });

  it("keeps a typed size only within the same kind of type", () => {
    expect(pgTypePatch("varchar", col("VARCHAR2", "40"))).toEqual({ type: "VARCHAR2", size: "40" });
    expect(pgTypePatch("varchar", col("NUMBER", "19"))).toEqual({ type: "VARCHAR2", size: "100" });
    expect(pgTypePatch("bigint", col("VARCHAR2", "40"))).toEqual({ type: "NUMBER", size: "19" });
    expect(pgTypePatch("text", col("VARCHAR2", "40"))).toEqual({ type: "CLOB", size: "" });
  });

  it("moves Oracle columns to PostgreSQL twins that keep their meaning", () => {
    expect(toPostgresColumn(col("DATE"))).toMatchObject({ type: "TIMESTAMP", size: "0" });
    expect(toPostgresColumn(col("NUMBER", "9"))).toMatchObject({ type: "NUMBER", size: "10" });
    expect(toPostgresColumn(col("NUMBER", "", { pk: true }))).toMatchObject({ type: "NUMBER", size: "19" });
    expect(toPostgresColumn(col("NUMBER", "12,2"))).toMatchObject({ type: "NUMBER", size: "12,2" });
    expect(toPostgresColumn(col("NVARCHAR2", "50"))).toMatchObject({ type: "VARCHAR2", size: "50" });
    expect(toPostgresColumn(col("FLOAT"))).toMatchObject({ type: "BINARY_DOUBLE", size: "" });
    expect(toPostgresColumn(col("RAW", "8"))).toMatchObject({ type: "BLOB", size: "" });
    const same = col("VARCHAR2", "20");
    expect(toPostgresColumn(same)).toBe(same);
  });

  it("converts a diagram both ways, keeping keys and references matched", () => {
    const parent = makeTable("PARENT", 0, 0);
    const child = makeTable("CHILD", 0, 0);
    child.columns.push(col("NUMBER", "", { name: "PARENT_ID", fk: { tableId: parent.id, columnId: parent.columns[0].id } }));
    child.columns.push(col("DATE", "", { name: "MADE_AT" }));
    const schema: Schema = { ...makeEmptySchema(), tables: [parent, child] };
    const pg = convertToPostgres(schema);
    expect(pg.dialect).toBe("postgres");
    expect(pg.tables[0].keyStrategy).toBe("identity");
    expect(typeName(pg.tables[0].columns[0], "postgres")).toBe("bigint");
    expect(typeName(pg.tables[1].columns[1], "postgres")).toBe("bigint");
    expect(typeName(pg.tables[1].columns[2], "postgres")).toBe("timestamp(0)");
    // Still valid Oracle: the Oracle export keeps working.
    expect(generateDDL(pg)).toContain("parent_id   number(19)");
    expect(convertToOracle(pg).dialect).toBeUndefined();
  });

  it("writes a PostgreSQL diagram's script in the names it shows, without Oracle remarks", () => {
    const table = makeTable("EVENTS", 0, 0);
    table.keyStrategy = "identity";
    table.columns = [col("NUMBER", "19", { name: "ID", pk: true, notNull: true }), col("DATE", "", { name: "DAY" }), col("NUMBER", "10", { name: "N" })];
    const sql = generatePostgres({ ...makeEmptySchema("x", "id", "postgres"), tables: [table] }).sql;
    expect(sql).toMatch(/id\s+bigint\s+generated always as identity/);
    expect(sql).toMatch(/day\s+date/);
    expect(sql).toMatch(/n\s+integer/);
    expect(sql).not.toContain("-- Oracle");
  });

  it("keeps the dialect through a JSON export", () => {
    const schema = makeEmptySchema("x", "id", "postgres");
    expect(parseSchemaJson(exportSchemaJson(schema)).schema?.dialect).toBe("postgres");
    expect(parseSchemaJson(exportSchemaJson(makeEmptySchema())).schema?.dialect).toBeUndefined();
  });
});

describe("PostgreSQL-only types", () => {
  const pgSchema = (tables: ReturnType<typeof makeTable>[], extra: Partial<Schema> = {}): Schema => ({ ...makeEmptySchema("x", "id", "postgres"), tables, ...extra });

  it("remembers a type with no Oracle twin beside the Oracle type it is stored as", () => {
    const jsonb = { ...col("VARCHAR2", "100"), ...pgTypePatch("jsonb", col("VARCHAR2", "100")) };
    expect(jsonb).toMatchObject({ type: "CLOB", size: "", postgresType: "jsonb" });
    expect(typeName(jsonb, "postgres")).toBe("jsonb");
    expect(typeName(jsonb, "oracle")).toBe("CLOB");
    expect(choiceOf(jsonb, "postgres")).toBe("jsonb");
    // Picking a plain type clears it again.
    expect(pgTypePatch("text", jsonb)).toEqual({ type: "CLOB", size: "", postgresType: undefined });
    // It no longer counts once the Oracle type is changed under it.
    expect(typeName({ ...jsonb, type: "BLOB" }, "postgres")).toBe("bytea");
  });

  it("writes them in the PostgreSQL script and stand-ins in the Oracle DDL", () => {
    const table = makeTable("EVENTS", 0, 0);
    table.keyStrategy = "none";
    const flag = { ...col("CHAR", "1", { name: "ACTIVE", check: "ACTIVE IN ('Y','N')" }), ...pgTypePatch("boolean", col("CHAR", "1")) };
    table.columns = [
      { ...col("NUMBER", "10", { name: "ID", pk: true, notNull: true }), ...pgTypePatch("serial", col("NUMBER")) },
      { ...col("CLOB", "", { name: "PAYLOAD" }), ...pgTypePatch("jsonb", col("CLOB")) },
      { ...flag, check: "" },
      { ...col("VARCHAR2", "45", { name: "IP" }), ...pgTypePatch("inet", col("VARCHAR2")) },
      { ...col("CLOB", "", { name: "TAGS" }), ...pgTypePatch("text[]", col("CLOB")) },
    ];
    const sql = generatePostgres(pgSchema([table])).sql;
    expect(sql).toMatch(/id\s+serial/);
    expect(sql).toMatch(/payload\s+jsonb/);
    expect(sql).toMatch(/active\s+boolean/);
    expect(sql).toMatch(/ip\s+inet/);
    expect(sql).toMatch(/tags\s+text\[\]/);
    const oracle = generateDDL(pgSchema([table]));
    expect(oracle).toMatch(/payload\s+clob/);
    expect(oracle).toMatch(/active\s+char\(1\)/);
  });

  it("points a foreign key at a serial key with a plain integer", () => {
    const parent = makeTable("PARENT", 0, 0);
    parent.keyStrategy = "none";
    parent.columns = [{ ...col("NUMBER", "19", { name: "ID", pk: true, notNull: true }), ...pgTypePatch("bigserial", col("NUMBER")) }];
    const child = makeTable("CHILD", 0, 0);
    child.keyStrategy = "none";
    child.columns = [col("NUMBER", "19", { name: "ID", pk: true, notNull: true }), col("NUMBER", "19", { name: "PARENT_ID", fk: { tableId: parent.id, columnId: parent.columns[0].id } })];
    const sql = generatePostgres(pgSchema([parent, child])).sql;
    expect(sql).toMatch(/id\s+bigserial/);
    expect(sql).toMatch(/parent_id\s+bigint/);
  });

  it("puts a schema group's tables in its tablespaces, as the Oracle DDL does", () => {
    const table = makeTable("TABLE_1", 0, 0);
    table.schemaId = "g1";
    table.indexes = [{ id: "i1", columnIds: [table.columns[0].id] }];
    const schema = pgSchema([table], { groups: [{ id: "g1", name: "Schema 1", keyword: "FDGDFH", x: 0, y: 0, width: 400, height: 300, color: "orange" }] });
    expect(generateDDL(schema)).toContain("using index tablespace fdgdfh_index;");
    const sql = generatePostgres(schema).sql;
    expect(sql).toContain("primary key (id) using index tablespace fdgdfh_index");
    expect(sql).toContain(") tablespace fdgdfh_data;");
    expect(sql).toContain("create tablespace fdgdfh_data location");
  });
});

describe("PostgreSQL issues", () => {
  it("drops Oracle's own limits and adds what PostgreSQL would refuse, with the fix", async () => {
    const { postgresIssues } = await import("@/app/lib/postgres-issues");
    const { validateSchema } = await import("@/app/lib/validation");
    const table = makeTable("ORDER", 0, 0);
    table.columns.push(col("VARCHAR2", "10", { name: "CODE", defaultValue: "DECODE(1,1,'A','B')" }));
    const schema: Schema = { ...makeEmptySchema("x", "id", "postgres"), tables: [table] };
    expect(validateSchema(schema).some((issue) => /reserved Oracle word/.test(issue.message))).toBe(true);
    const issues = postgresIssues(schema);
    expect(issues.some((issue) => /reserved Oracle word/.test(issue.message))).toBe(false);
    const decode = issues.find((issue) => /DECODE/.test(issue.message));
    expect(decode).toMatchObject({ severity: "warning", tableId: table.id });
    expect(decode?.message).toMatch(/CASE expression/);
  });
});
