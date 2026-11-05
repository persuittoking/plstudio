import { describe, expect, it } from "vitest";
import { draftDocument } from "@/app/lib/document-draft";
import { renderDocument } from "@/app/lib/documentation";
import { makeDemoSchema, makeEmptySchema } from "@/app/lib/schema";

describe("the draft written from the diagram", () => {
  const schema = makeDemoSchema(); // STUDENT, and ENROLLMENT pointing at it

  it("counts the tables, links and columns", () => {
    const text = draftDocument(schema, "en");
    expect(text).toContain("==2 tables==, ==1 relationship==");
    expect(text).toContain(":::stats\n### 2 | Tables");
  });

  it("names the table the others lean on, and how each key is made", () => {
    const text = draftDocument(schema, "en");
    const [student, enrollment] = schema.tables.map((table) => `**=={${table.color.a}}${table.name}==**`);
    expect(text).toContain(`the central table is ${student}`);
    expect(text).toContain(`- ${student} — IDs come from a !!+sequence and trigger!!.`);
    expect(text).toContain(`Refers to ${student}.`);
    expect(text).toContain(`Referred to by ${enrollment}.`);
  });

  it("orders creation so a table comes after the tables it refers to", () => {
    const text = draftDocument(schema, "en");
    const [student, enrollment] = schema.tables.map((table) => `**=={${table.color.a}}${table.name}==**`);
    expect(text.indexOf(`1. ${student}`)).toBeGreaterThan(0);
    expect(text).toContain(`2. ${enrollment} — after ${student}`);
  });

  it("draws the links as a flow and keeps every schema block", () => {
    const text = draftDocument(schema, "uz");
    ["{{er}}", "{{columns STUDENT}}", "{{columns ENROLLMENT}}", "{{relationships}}", "```mermaid\nflowchart LR"].forEach((part) => expect(text).toContain(part));
    expect(text).toContain("T1 -->|STUDENT_ID| T2");
  });

  it("lists what to check, and renders without a missing block", () => {
    const text = draftDocument(schema, "ru");
    expect(text).toContain("## Что стоит проверить");
    expect(text).toContain(`У таблицы **=={${schema.tables[0].color.a}}STUDENT==** ==нет комментария==.`);
    expect(renderDocument(schema, text, { theme: "light", diagrams: new Map(), generatedAt: "" }).body).not.toMatch(/class="warning"/);
  });

  it("still makes a page for an empty diagram", () => {
    const text = draftDocument(makeEmptySchema("Bo'sh"), "uz");
    expect(text).toContain("# Bo'sh");
    expect(text).not.toContain("{{er}}");
  });

  it("writes every table's name in the colour of its card", () => {
    const text = draftDocument(schema, "uz");
    for (const table of schema.tables) expect(text).toContain(`### **=={${table.color.a}}${table.name}==** ustunlari`);
    expect(renderDocument(schema, text, { theme: "light", diagrams: new Map(), generatedAt: "" }).body)
      .toContain(`<strong><mark class="hl custom" style="background:${schema.tables[0].color.a}59">STUDENT</mark></strong>`);
  });
});
