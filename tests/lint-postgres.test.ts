import { describe, expect, it } from "vitest";
import { typeName } from "@/app/lib/dialect";
import { applyLintFix, LINT_RULES, lintRulesFor, lintSchema, type LintRuleId } from "@/app/lib/lint";
import { generatePostgres } from "@/app/lib/postgres";
import { makeColumn, makeEmptySchema, makeTable, normalizeRelationships, type Column, type Schema, type Table } from "@/app/lib/schema";

const table = (name: string, columns: Partial<Column>[], extra: Partial<Table> = {}): Table =>
  ({ ...makeTable(name, 0, 0), comment: `${name} rows.`, columns: columns.map((column) => makeColumn(column)), ...extra });
const pg = (...tables: Table[]): Schema => normalizeRelationships({ ...makeEmptySchema("x", "id", "postgres"), tables });
const oracle = (...tables: Table[]): Schema => normalizeRelationships({ ...makeEmptySchema(), tables });
const key = { name: "ID", type: "NUMBER" as const, size: "19", pk: true, notNull: true };
const rule = (schema: Schema, id: LintRuleId) => lintSchema(schema).filter((finding) => finding.ruleId === id);
const fixAll = (schema: Schema, id: LintRuleId) => rule(schema, id).reduce(applyLintFix, schema);
const col = (schema: Schema, name: string) => schema.tables.flatMap((t) => t.columns).find((c) => c.name === name)!;

describe("lint in a PostgreSQL diagram", () => {
  it("lists PostgreSQL's rules and leaves out Oracle-only ones", () => {
    const ids = lintRulesFor("postgres").map((rule) => rule.id);
    expect(ids).toContain("pg-json");
    expect(ids).not.toContain("string-extended");
    expect(ids).not.toContain("lob-in-key");
    expect(lintRulesFor("oracle").map((rule) => rule.id)).not.toContain("pg-json");
    expect(LINT_RULES.length).toBe(lintRulesFor("oracle").length + lintRulesFor("postgres").filter((rule) => rule.dialects).length);
  });

  it("speaks of PostgreSQL in shared rules", () => {
    const schema = pg(table("ORDERS", [key, { name: "createdBy", type: "VARCHAR2", size: "50" }]));
    const [camel] = rule(schema, "camel-case-name");
    expect(camel.message).toMatch(/PostgreSQL lowercases unquoted names, so this becomes createdby; use created_by/);
    expect(rule(oracle(table("ORDERS", [key, { name: "createdBy", type: "VARCHAR2", size: "50" }])), "camel-case-name")[0].message).toMatch(/Oracle uppercases/);
  });

  it("does not raise Oracle's size limit in a PostgreSQL diagram", () => {
    const big = table("NOTES", [key, { name: "BODY", type: "VARCHAR2", size: "8000" }]);
    expect(rule(pg(big), "string-extended")).toEqual([]);
    expect(rule(oracle(big), "string-extended")).toHaveLength(1);
  });

  it("moves a timestamp-like date to timestamptz", () => {
    const schema = pg(table("EVENTS", [key, { name: "CREATED_AT", type: "DATE", size: "" }]));
    expect(rule(schema, "date-for-timestamp")[0].message).toMatch(/date stores no time of day/);
    expect(typeName(col(fixAll(schema, "date-for-timestamp"), "CREATED_AT"), "postgres")).toBe("timestamptz");
  });

  it("moves json to jsonb, money to numeric and timestamp to timestamptz", () => {
    const schema = pg(table("ORDERS", [
      key,
      { name: "DATA", type: "CLOB", size: "", postgresType: "json" },
      { name: "TOTAL", type: "NUMBER", size: "19,2", postgresType: "money" },
      { name: "PAID_AT", type: "TIMESTAMP", size: "" },
    ]));
    let fixed = fixAll(schema, "pg-json");
    fixed = fixAll(fixed, "pg-money");
    fixed = fixAll(fixed, "pg-timestamptz");
    expect(typeName(col(fixed, "DATA"), "postgres")).toBe("jsonb");
    expect(typeName(col(fixed, "TOTAL"), "postgres")).toBe("numeric(19,2)");
    expect(typeName(col(fixed, "PAID_AT"), "postgres")).toBe("timestamptz");
    expect(lintSchema(fixed).filter((finding) => finding.ruleId.startsWith("pg-"))).toEqual([]);
  });

  it("turns a serial key into an identity", () => {
    const schema = pg(table("USERS", [{ ...key, postgresType: "bigserial" }], { keyStrategy: "none" }));
    const [finding] = rule(schema, "pg-serial");
    expect(finding.fix).toMatchObject({ kind: "useIdentity", label: "Use identity" });
    const fixed = applyLintFix(schema, finding);
    expect(fixed.tables[0].keyStrategy).toBe("identity");
    expect(generatePostgres(fixed).sql).toMatch(/id\s+bigint\s+generated always as identity/);
  });

  it("flags reserved and over-long names", () => {
    const schema = pg(table("ORDER", [key, { name: "USER", type: "VARCHAR2", size: "10" }, { name: "X".repeat(64), type: "VARCHAR2", size: "10" }]));
    expect(rule(schema, "pg-reserved-name").map((finding) => finding.message).join(" ")).toMatch(/order is a reserved word.*user is a reserved word/);
    expect(rule(schema, "pg-long-name")).toHaveLength(1);
  });

  it("adds a bigint identity key to a table without one", () => {
    const schema = pg(table("LOGS", [{ name: "MSG", type: "CLOB", size: "" }], { keyStrategy: "none" }));
    const fixed = fixAll(schema, "table-no-pk");
    expect(typeName(fixed.tables[0].columns[0], "postgres")).toBe("bigint");
    expect(fixed.tables[0].keyStrategy).toBe("identity");
  });
});

describe("errors in a PostgreSQL diagram", () => {
  it("says Oracle's errors in PostgreSQL terms", async () => {
    const { postgresIssues } = await import("@/app/lib/postgres-issues");
    const parent = table("PARENT", [key]);
    const child = table("CORE_DASHBOARD_WIDGETS", [
      key,
      { name: "FUNCTION_CODE", type: "VARCHAR2", size: "50", check: "FUNCTION_CODE IN ('A', 'B'); DROP TABLE X" },
      { name: "NAME", type: "VARCHAR2", size: "" },
      { name: "PARENT_ID", type: "VARCHAR2", size: "10", fk: { tableId: parent.id, columnId: parent.columns[0].id } },
      { name: "SEEN_AT", type: "TIMESTAMP", size: "9" },
    ]);
    const messages = postgresIssues(pg(parent, child)).map((issue) => issue.message).join("\n");
    expect(messages).not.toMatch(/Oracle/);
    expect(messages).toMatch(/CORE_DASHBOARD_WIDGETS\.FUNCTION_CODE: CHECK must be one PostgreSQL condition/);
    expect(messages).toMatch(/NAME: varchar requires a size or precision/);
    expect(messages).toMatch(/this is varchar\(10\), PARENT\.ID is bigint/);
    expect(messages).toMatch(/timestamp precision must be 0–6 in PostgreSQL/);
  });

  it("says the composite-key error in PostgreSQL terms, and switches back to Oracle's with the diagram", async () => {
    const { postgresIssues } = await import("@/app/lib/postgres-issues");
    const { validateSchema } = await import("@/app/lib/validation");
    const parent = table("PARENT", [key, { name: "CODE", type: "VARCHAR2", size: "10", pk: true, notNull: true }]);
    const child = table("CHILD", [key, { name: "PARENT_ID", type: "NUMBER", size: "19", fk: { tableId: parent.id, columnId: parent.columns[0].id } }]);
    const schema = pg(parent, child);
    const postgres = postgresIssues(schema).map((issue) => issue.message).join("\n");
    expect(postgres).toMatch(/CHILD\.PARENT_ID: points at ID of a table whose primary key has several columns; PostgreSQL needs/);
    expect(postgres).not.toMatch(/Oracle|v1/);
    // The same diagram as Oracle: Oracle's own messages.
    expect(validateSchema({ ...schema, dialect: undefined }).map((issue) => issue.message).join("\n")).toMatch(/composite-PK targets require FK groups/);
  });
});
