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
    expect(text).toContain("the central table is `STUDENT`");
    expect(text).toContain("- `STUDENT` — IDs come from a !!+sequence and trigger!!.");
    expect(text).toContain("Refers to `STUDENT`.");
    expect(text).toContain("Referred to by `ENROLLMENT`.");
  });

  it("orders creation so a table comes after the tables it refers to", () => {
    const text = draftDocument(schema, "en");
    expect(text.indexOf("1. **`STUDENT`**")).toBeGreaterThan(0);
    expect(text).toContain("2. **`ENROLLMENT`** — after `STUDENT`");
  });

  it("draws the links as a flow and keeps every schema block", () => {
    const text = draftDocument(schema, "uz");
    ["{{er}}", "{{columns STUDENT}}", "{{columns ENROLLMENT}}", "{{relationships}}", "```mermaid\nflowchart LR"].forEach((part) => expect(text).toContain(part));
    expect(text).toContain("T1 -->|STUDENT_ID| T2");
  });

  it("lists what to check, and renders without a missing block", () => {
    const text = draftDocument(schema, "ru");
    expect(text).toContain("## Что стоит проверить");
    expect(text).toContain("У таблицы `STUDENT` ==нет комментария==.");
    expect(renderDocument(schema, text, { theme: "light", diagrams: new Map(), generatedAt: "" }).body).not.toMatch(/class="warning"/);
  });

  it("still makes a page for an empty diagram", () => {
    const text = draftDocument(makeEmptySchema("Bo'sh"), "uz");
    expect(text).toContain("# Bo'sh");
    expect(text).not.toContain("{{er}}");
  });
});
