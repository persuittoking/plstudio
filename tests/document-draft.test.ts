import { describe, expect, it } from "vitest";
import { draftDocument } from "@/app/lib/document-draft";
import { renderDocument } from "@/app/lib/documentation";
import { makeDemoSchema, makeEmptySchema } from "@/app/lib/schema";

describe("the draft written from the diagram", () => {
  const schema = makeDemoSchema(); // STUDENT, and ENROLLMENT pointing at it
  /** A table's name inside a sentence: bold words in its card's colour. */
  const word = (index: number) => `**!!{${schema.tables[index].color.a}}${schema.tables[index].name}!!**`;
  /** The same name in a heading or a card: a chip in its card's colour. */
  const chip = (index: number) => `**=={${schema.tables[index].color.a}}${schema.tables[index].name}==**`;

  it("counts the tables, links and columns, and names the database", () => {
    const text = draftDocument(schema, "en");
    expect(text).toContain("^ Oracle · database architecture");
    expect(text).toContain("==2 tables==, ==1 relationship==");
    expect(text).toContain(":::stats\n### 2 | Tables");
  });

  it("names the table the others lean on, and how each key is made, one labelled line each", () => {
    const text = draftDocument(schema, "en");
    expect(text).toContain(`**The central table is ${chip(0)}.**`);
    expect(text).toContain(`- **Keys:** [[+sequence + trigger]] ${word(0)}`);
    expect(text).toContain(`- **Refers to →** ${word(0)}`);
    expect(text).toContain(`- **Referred to by ←** ${word(1)}`);
  });

  it("orders creation so a table comes after the tables it refers to", () => {
    const text = draftDocument(schema, "en");
    expect(text).toContain(`1. ${word(0)} — [[+first]] depends on nothing`);
    expect(text).toContain(`2. ${word(1)} — after ${word(0)}`);
  });

  it("draws the links as a flow and keeps every schema block", () => {
    const text = draftDocument(schema, "uz");
    ["{{er}}", "{{columns STUDENT}}", "{{columns ENROLLMENT}}", "{{relationships}}", "```mermaid\nflowchart LR"].forEach((part) => expect(text).toContain(part));
    expect(text).toContain("T1 -->|STUDENT_ID| T2");
  });

  it("lists what to check, and renders without a missing block", () => {
    const text = draftDocument(schema, "ru");
    expect(text).toContain("## Что стоит проверить");
    expect(text).toContain(`- [[{#d97706}НЕТ КОММЕНТАРИЯ]] У таблицы ${word(0)} нет комментария.`);
    expect(renderDocument(schema, text, { theme: "light", diagrams: new Map(), generatedAt: "" }).body).not.toMatch(/class="warning"/);
  });

  it("still makes a page for an empty diagram", () => {
    const text = draftDocument(makeEmptySchema("Bo'sh"), "uz");
    expect(text).toContain("# Bo'sh");
    expect(text).not.toContain("{{er}}");
  });

  it("writes every table's name in the colour of its card", () => {
    const text = draftDocument(schema, "uz");
    schema.tables.forEach((table, index) => expect(text).toContain(`### ${chip(index)} ustunlari`));
    const body = renderDocument(schema, text, { theme: "light", diagrams: new Map(), generatedAt: "" }).body;
    expect(body).toContain(`<strong><mark class="hl custom" style="background:${schema.tables[0].color.a}59">STUDENT</mark></strong>`);
    expect(body).toMatch(new RegExp(`<strong><span class="tc custom" style="color:${schema.tables[0].color.a}">STUDENT</span></strong>`));
  });

  it("speaks PostgreSQL in a PostgreSQL diagram", () => {
    const pg = { ...schema, dialect: "postgres" as const };
    const text = draftDocument(pg, "en");
    expect(text).toContain("^ PostgreSQL · database architecture");
    expect(text).toContain("[[+IDENTITY]]");
    expect(text).not.toContain("sequence + trigger");
  });
});
