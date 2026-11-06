import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applySchemaToYDoc, schemaFromYDoc } from "@/app/lib/collab/ydoc";
import { applyLintFix, LINT_RULES, lintSchema, type LintRuleId } from "@/app/lib/lint";
import { exportSchemaJson, parseSchemaJson } from "@/app/lib/schema-json";
import { makeColumn, makeEmptySchema, makeIndex, makeTable, normalizeRelationships, type Column, type Schema, type Table } from "@/app/lib/schema";

const table = (name: string, columns: Partial<Column>[], extra: Partial<Table> = {}): Table =>
  ({ ...makeTable(name, 0, 0), comment: `${name} rows.`, columns: columns.map((column) => makeColumn(column)), ...extra });

/** PARENT(ID) <- CHILD(PARENT_ID), related through `Column.fk` and materialised the way the designer holds it. */
const base = (child: Partial<Column> = {}) => {
  const parent = table("PARENT", [{ name: "ID", type: "NUMBER", size: "", pk: true, notNull: true }]);
  const kid = table("CHILD", [{ name: "ID", type: "NUMBER", size: "", pk: true, notNull: true }, { name: "PARENT_ID", type: "NUMBER", size: "", fk: { tableId: parent.id, columnId: parent.columns[0].id }, ...child }]);
  return normalizeRelationships({ ...makeEmptySchema(), tables: [parent, kid] });
};
const rule = (schema: Schema, id: LintRuleId) => lintSchema(schema).filter((finding) => finding.ruleId === id);
const fixAll = (schema: Schema, id: LintRuleId) => rule(schema, id).reduce(applyLintFix, schema);

describe("lintSchema", () => {
  it("finds nothing on a tidy diagram once its FK is indexed", () => {
    const schema = base();
    schema.tables[1].indexes = [makeIndex([schema.tables[1].columns[1].id])];
    expect(lintSchema(schema)).toEqual([]);
  });

  it("flags an unindexed FK whether or not relationships were materialised", () => {
    expect(rule(base(), "fk-unindexed")).toHaveLength(1);
    expect(rule({ ...base(), relationships: [] }, "fk-unindexed")).toHaveLength(1);
  });

  it("accepts any key whose leading columns are the FK columns, in any order", () => {
    const schema = base();
    const [id, parentId] = schema.tables[1].columns;
    schema.tables[1].indexes = [makeIndex([id.id, parentId.id])];
    expect(rule(schema, "fk-unindexed")).toHaveLength(1);
    schema.tables[1].indexes = [makeIndex([parentId.id, id.id])];
    expect(rule(schema, "fk-unindexed")).toEqual([]);
    schema.tables[1].indexes = [];
    schema.tables[1].columns[1].unique = true;
    expect(rule(schema, "fk-unindexed")).toEqual([]);
  });

  it("flags keys and nullability problems", () => {
    const schema = base({ notNull: true });
    schema.relationships![0] = { ...schema.relationships![0], deleteConstraint: "Set null", cardinality: "one_to_one" };
    schema.tables.push(table("LOOSE", [{ name: "CODE" }]));
    expect(rule(schema, "set-null-not-null")).toHaveLength(1);
    expect(rule(schema, "one-to-one-not-unique")).toHaveLength(1);
    expect(rule(schema, "table-no-pk").map((finding) => finding.tableId)).toEqual([schema.tables[2].id]);
  });

  it("flags type choices", () => {
    const schema = makeEmptySchema();
    schema.tables = [table("T", [
      { name: "ID", type: "NUMBER", size: "", pk: true },
      { name: "FLAG", type: "CHAR", size: "1" },
      { name: "CODE", type: "CHAR", size: "10" },
      { name: "CREATED_AT", type: "DATE", size: "" },
      { name: "BIRTH_DATE", type: "DATE", size: "" },
      { name: "NOTES", type: "VARCHAR2", size: "8000" },
      { name: "BODY", type: "CLOB", size: "" },
    ])];
    schema.tables[0].indexes = [makeIndex([schema.tables[0].columns[6].id])];
    const names = (id: LintRuleId) => rule(schema, id).map((finding) => schema.tables[0].columns.find((column) => column.id === finding.columnId)?.name);
    expect(names("char-fixed-width")).toEqual(["CODE"]);
    expect(names("date-for-timestamp")).toEqual(["CREATED_AT"]);
    expect(names("string-extended")).toEqual(["NOTES"]);
    expect(names("lob-in-key")).toEqual(["BODY"]);
  });

  it("flags naming and docs", () => {
    const schema = base({ name: "OWNER" });
    schema.tables[0].comment = "";
    schema.tables[1].columns.push(makeColumn({ name: "orderTotal", type: "NUMBER", size: "" }));
    schema.tables.push(table("auditLog", [{ name: "ID", type: "NUMBER", size: "", pk: true }]));
    expect(rule(schema, "fk-name")[0].fix).toMatchObject({ kind: "renameColumn", name: "PARENT_ID" });
    expect(rule(schema, "camel-case-name").map((finding) => finding.fix && "name" in finding.fix && finding.fix.name)).toEqual(["ORDER_TOTAL", "AUDIT_LOG"]);
    expect(rule(schema, "table-no-comment").map((finding) => finding.tableId)).toEqual([schema.tables[0].id]);
    expect(rule(schema, "orphan-table").map((finding) => finding.tableId)).toEqual([schema.tables[2].id]);
  });

  it("skips disabled rules", () => {
    const schema = { ...base(), lint: { disabled: ["fk-unindexed"] } };
    expect(rule(schema, "fk-unindexed")).toEqual([]);
  });

  it("names every rule once", () => {
    expect(new Set(LINT_RULES.map((rule) => rule.id)).size).toBe(LINT_RULES.length);
  });
});

describe("applyLintFix", () => {
  it("indexes the FK, and a second application changes nothing", () => {
    const schema = base();
    const [finding] = rule(schema, "fk-unindexed");
    const fixed = applyLintFix(schema, finding);
    expect(fixed.tables[1].indexes?.[0].columnIds).toEqual([schema.tables[1].columns[1].id]);
    expect(rule(fixed, "fk-unindexed")).toEqual([]);
    expect(applyLintFix(fixed, finding)).toBe(fixed);
  });

  it("does nothing when a collaborator already fixed the problem", () => {
    const schema = base();
    const [finding] = rule(schema, "fk-unindexed");
    const theirs = structuredClone(schema);
    theirs.tables[1].indexes = [makeIndex([theirs.tables[1].columns[1].id], "THEIRS")];
    expect(applyLintFix(theirs, finding)).toBe(theirs);
  });

  it("does nothing when the entity changed so the fix would differ", () => {
    const schema = makeEmptySchema();
    schema.tables = [table("T", [{ name: "ID", type: "NUMBER", size: "", pk: true }, { name: "orderItem" }])];
    const [finding] = rule(schema, "camel-case-name");
    const edited = structuredClone(schema);
    edited.tables[0].columns[1].name = "updatedItem";
    expect(rule(edited, "camel-case-name")[0].key).toBe(finding.key);
    expect(applyLintFix(edited, finding)).toBe(edited);
    expect(fixAll(edited, "camel-case-name").tables[0].columns[1].name).toBe("UPDATED_ITEM");
  });

  it("adds a primary key, reusing an existing ID column", () => {
    const schema = makeEmptySchema();
    schema.tables = [table("A", [{ name: "NAME" }]), table("B", [{ name: "id", type: "NUMBER", size: "" }])];
    const fixed = fixAll(schema, "table-no-pk");
    expect(fixed.tables[0].columns.map((column) => [column.name, column.pk])).toEqual([["ID", true], ["NAME", false]]);
    expect(fixed.tables[1].columns).toHaveLength(1);
    expect(fixed.tables[1].columns[0]).toMatchObject({ pk: true, notNull: true });
  });

  it("relaxes NOT NULL for SET NULL and enforces one-to-one", () => {
    const schema = base({ notNull: true });
    schema.relationships![0] = { ...schema.relationships![0], deleteConstraint: "Set null", cardinality: "one_to_one" };
    const fixed = fixAll(fixAll(schema, "set-null-not-null"), "one-to-one-not-unique");
    expect(fixed.tables[1].columns[1]).toMatchObject({ notNull: false, unique: true });
  });

  it("retypes CHAR only when no foreign key depends on the type", () => {
    const schema = base({ type: "CHAR", size: "10" });
    schema.tables[0].columns[0] = { ...schema.tables[0].columns[0], type: "CHAR", size: "10" };
    expect(rule(schema, "char-fixed-width").every((finding) => !finding.fix)).toBe(true);
    schema.tables.push(table("C", [{ name: "ID", type: "NUMBER", size: "", pk: true }, { name: "CODE", type: "NCHAR", size: "3" }]));
    expect(fixAll(schema, "char-fixed-width").tables[2].columns[1]).toMatchObject({ type: "NVARCHAR2", size: "3" });
  });

  it("renames, and offers no rename that would collide", () => {
    const schema = base({ name: "OWNER" });
    expect(fixAll(schema, "fk-name").tables[1].columns[1].name).toBe("PARENT_ID");
    schema.tables[1].columns.push(makeColumn({ name: "PARENT_ID" }));
    expect(rule(schema, "fk-name")[0].fix).toBeUndefined();
    const camel = makeEmptySchema();
    camel.tables = [table("orderItem", [{ name: "ID", type: "NUMBER", size: "", pk: true }])];
    expect(fixAll(camel, "camel-case-name").tables[0].name).toBe("ORDER_ITEM");
  });
});

describe("lint settings persistence", () => {
  const disabled = () => ({ ...base(), lint: { disabled: ["orphan-table", "fk-name"] } });

  it("round-trips through the Y.Doc, and an empty list is absent", () => {
    const ydoc = new Y.Doc();
    applySchemaToYDoc(ydoc, disabled());
    expect(schemaFromYDoc(ydoc).lint).toEqual({ disabled: ["orphan-table", "fk-name"] });
    applySchemaToYDoc(ydoc, { ...disabled(), lint: undefined });
    expect(schemaFromYDoc(ydoc).lint).toBeUndefined();
  });

  it("round-trips through JSON export, and leaves it out when nothing is off", () => {
    expect(parseSchemaJson(exportSchemaJson(disabled())).schema?.lint).toEqual({ disabled: ["orphan-table", "fk-name"] });
    expect(exportSchemaJson(base())).not.toContain('"lint"');
  });
});
