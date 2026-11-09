import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applySchemaToYDoc, schemaFromYDoc } from "@/app/lib/collab/ydoc";
import { generateDML, generatePackage } from "@/app/lib/generators";
import { exportSchemaJson, mergeSchemaJson, parseSchemaJson } from "@/app/lib/schema-json";
import { columnImpact } from "@/app/lib/impact";
import { validateSchema } from "@/app/lib/validation";
import { makeEmptySchema, makePackage, makeDemoSchema, normalizePackages, packageHeight, prunePackages, type Schema } from "@/app/lib/schema";

const withPackage = (): Schema => {
  const schema = makeDemoSchema();
  const pkg = { ...makePackage("Student_Api"), tableIds: [schema.tables[0].id] };
  return { ...schema, packages: [{ ...pkg, procedures: [{ id: "p1", kind: "function", name: "Count_All", params: "", returns: "number", body: "begin\n  return 1;\nend;" }] }] };
};

describe("packages", () => {
  it("keeps the derived body when no package is defined", () => {
    const schema = makeDemoSchema();
    expect(generateDML(schema)).toBe(generateDML({ ...schema, packages: [] }));
    expect(generateDML(schema)).toMatch(/^create or replace package body \w+_Dml is/);
  });

  it("emits a spec and a body for each defined package, covering only its tables", () => {
    const schema = withPackage();
    const { spec, body, name } = generatePackage(schema, schema.packages![0]);
    expect(name).toBe("STUDENT_API");
    expect(spec).toMatch(/^create or replace package STUDENT_API is/);
    expect(spec).toContain("Procedure Ins_");
    expect(spec).toContain("Function Count_All return number;");
    expect(body).toContain("Function Count_All return number is\n  begin\n    return 1;\n  end;");
    expect(body).not.toContain(schema.tables[1].name);
    expect(generateDML(schema)).toContain("end STUDENT_API;\n/");
  });

  it("omits generated CRUD when includeCrud is off", () => {
    const schema = withPackage();
    schema.packages![0].includeCrud = false;
    expect(generatePackage(schema, schema.packages![0]).spec).not.toContain("Ins_");
  });

  it("prunes tables that no longer exist and tolerates junk", () => {
    const [pkg] = normalizePackages([{ id: "a", name: 3, tableIds: ["t1", "gone", "t1"], procedures: [null, { id: "x", kind: "bogus" }] }, null, { id: "a" }], ["t1"]);
    expect(pkg.tableIds).toEqual(["t1"]);
    expect(pkg.name).toBe("");
    expect(pkg.procedures).toEqual([{ id: "x", kind: "procedure", name: "", params: "", returns: undefined, body: "" }]);
    expect(normalizePackages("nope")).toEqual([]);
  });

  it("grows the card with its rows", () => {
    const schema = withPackage();
    expect(packageHeight(schema.packages![0])).toBeGreaterThan(packageHeight({ ...schema.packages![0], procedures: [] }));
  });

  it("round-trips through a Y.Doc", () => {
    const schema = withPackage();
    const doc = new Y.Doc();
    applySchemaToYDoc(doc, schema);
    expect(schemaFromYDoc(doc).packages).toEqual(schema.packages);
  });

  it("round-trips through the JSON export", () => {
    const schema = withPackage();
    expect(parseSchemaJson(exportSchemaJson(schema)).schema?.packages).toEqual(schema.packages);
  });

  it("merges a package with the tables it covers, under fresh ids", () => {
    const source = withPackage();
    const merged = mergeSchemaJson(makeEmptySchema(), exportSchemaJson(source)).schema!;
    expect(merged.packages).toHaveLength(1);
    expect(merged.packages![0].id).not.toBe(source.packages![0].id);
    expect(merged.packages![0].tableIds).toEqual([merged.tables.find((table) => table.name === source.tables[0].name)!.id]);
  });

  it("validates package and subprogram names", () => {
    const schema = withPackage();
    schema.packages!.push({ ...makePackage("student_api"), id: "dup" });
    schema.packages![0].procedures[0].name = "";
    const messages = validateSchema(schema).map((issue) => issue.message);
    expect(messages.some((message) => /package student_api collides/i.test(message))).toBe(true);
    expect(messages.some((message) => /Subprogram \(unnamed\).*cannot be empty/.test(message))).toBe(true);
  });

  it("drops a deleted table from its package on prune", () => {
    const schema = withPackage();
    const gone = { ...schema, tables: schema.tables.slice(1) };
    expect(prunePackages(gone).packages![0].tableIds).toEqual([]);
    expect(prunePackages(schema)).toBe(schema);
  });

  it("points impact analysis at the defining package, and nothing for an uncovered table", () => {
    const schema = withPackage();
    const labels = (tableIndex: number) => columnImpact(schema, { tableId: schema.tables[tableIndex].id, columnId: schema.tables[tableIndex].columns[0].id }).filter((item) => item.kind === "plsql").map((item) => item.label);
    expect(labels(0).every((label) => label.startsWith("STUDENT_API."))).toBe(true);
    expect(labels(0).length).toBeGreaterThan(0);
    expect(labels(1)).toEqual([]);
  });
});
