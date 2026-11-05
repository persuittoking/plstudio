import { describe, expect, it } from "vitest";
import { pushDown, reflowDiagram, renderDiagramSVG } from "@/app/components/designer/diagram-svg";
import { makeColumn, makeDemoSchema, makeMemo, makeSchemaGroup, makeTable, normalizeRelationships, tableHeight, tableWidth } from "@/app/lib/schema";

const viewBox = (svg: string) => svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);

describe("renderDiagramSVG", () => {
  it("draws every table and column of the diagram", () => {
    const schema = makeDemoSchema();
    const svg = renderDiagramSVG(schema);
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    schema.tables.forEach((table) => {
      // Document style: names read as the DDL spells them.
      expect(svg).toContain(`>${table.name.toLowerCase()}</text>`);
      table.columns.forEach((column) => expect(svg).toContain(column.name.toLowerCase()));
    });
    // The demo's one foreign key, curved, with a crow's foot at each end.
    expect(svg.match(/<path d="M [^"]* C [^"]*"[^>]*marker-start="url\(#crow-many\)" marker-end="url\(#crow-one\)"/g)).toHaveLength(1);
  });

  it("escapes text so a hostile name cannot break out of the document", () => {
    const schema = makeDemoSchema();
    schema.name = `A & B <script>`;
    schema.tables[0].name = `T<"x">&'`;
    schema.memos = [{ ...makeMemo(`</text><script>alert(1)</script>`, 0, 0), id: "memo_1" }];
    const svg = renderDiagramSVG(schema);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("A &amp; B &lt;script&gt;");
    expect(svg).toContain("t&lt;&quot;x&quot;&gt;&amp;&apos;");
  });

  it("frames every card, group and memo inside the viewBox", () => {
    const schema = makeDemoSchema();
    schema.tables.push({ ...makeTable("FAR_AWAY", -900, 1400), id: "tbl_far" });
    schema.groups = [{ ...makeSchemaGroup("Core", 2000, -300), id: "group_1" }];
    schema.memos = [{ ...makeMemo("note", -1200, -500), id: "memo_1" }];
    const [x, y, width, height] = viewBox(renderDiagramSVG(schema));
    const boxes = [
      ...schema.tables.map((table) => ({ x: table.x, y: table.y, width: tableWidth(table), height: tableHeight(table) })),
      ...schema.groups,
      ...schema.memos,
    ];
    boxes.forEach((box) => {
      expect(box.x).toBeGreaterThanOrEqual(x);
      expect(box.y).toBeGreaterThanOrEqual(y);
      expect(box.x + box.width).toBeLessThanOrEqual(x + width);
      expect(box.y + box.height).toBeLessThanOrEqual(y + height);
    });
  });

  it("is deterministic, and themed", () => {
    const schema = normalizeRelationships(makeDemoSchema());
    schema.tables[1].columns.push(makeColumn({ name: "NOTE" }));
    expect(renderDiagramSVG(schema)).toBe(renderDiagramSVG(structuredClone(schema)));
    expect(renderDiagramSVG(schema, { theme: "dark" })).not.toBe(renderDiagramSVG(schema));
  });

  it("renders an empty diagram as a small blank canvas", () => {
    const schema = makeDemoSchema();
    schema.tables = [];
    schema.relationships = [];
    expect(viewBox(renderDiagramSVG(schema))).toEqual([0, 0, 96, 96]);
  });

  it("paints memos in literal colours, since an exported file has no stylesheet for var() to resolve against", () => {
    const schema = makeDemoSchema();
    schema.memos = (["yellow", "green", "blue", "pink"] as const).map((color, index) => ({ ...makeMemo("note", index * 300, 600, color), id: `memo_${index}` }));
    (["light", "dark"] as const).forEach((theme) => expect(renderDiagramSVG(schema, { theme })).not.toContain("var("));
    expect(renderDiagramSVG(schema)).toContain(`fill="#f4efdc"`);
  });

  it("wraps memo text across lines and marks what does not fit", () => {
    const schema = makeDemoSchema();
    const sql = "insert into ies_day_count_types (day_count_type, name_mll_code) values (ies_day_count_types_seq.nextval, 'ACT/365');";
    schema.memos = [{ ...makeMemo(sql, 0, 600), id: "memo_1", width: 240, height: 120 }];
    const lines = [...renderDiagramSVG(schema).matchAll(/<tspan x="14" dy="\d+">([^<]*)<\/tspan>/g)].map((match) => match[1]);
    expect(lines).toHaveLength(4);
    // 28 characters to a 240px memo, so the table name moves to its own line whole.
    expect(lines.slice(0, 2)).toEqual(["insert into", "ies_day_count_types"]);
    expect(lines[3].endsWith("…")).toBe(true);
  });

  it("pushes a block down by what the one above it grew, keeping the gap, and leaves side-by-side and overlapping blocks alone", () => {
    const tops = pushDown([
      { id: "a", x: 0, y: 0, width: 100, before: 100, after: 160 },
      { id: "b", x: 0, y: 140, width: 100, before: 50, after: 50 },
      { id: "c", x: 300, y: 140, width: 100, before: 50, after: 50 },
      { id: "d", x: 0, y: 60, width: 100, before: 20, after: 20 },
    ]);
    expect(Object.fromEntries(tops)).toEqual({ a: 0, d: 60, b: 200, c: 140 });
  });

  it("reflows a commented table's neighbours inside a group, grows the group, and moves the group below it", () => {
    const schema = makeDemoSchema();
    const [student, enrollment] = schema.tables;
    const top = { ...makeSchemaGroup("Top", 0, 0), id: "g_top", height: 600 };
    const below = { ...makeSchemaGroup("Below", 0, 620), id: "g_below" };
    schema.groups = [top, below];
    Object.assign(student, { schemaId: top.id, x: 40, y: 60, comment: "Every student ever enrolled, including the ones who have since left the school entirely." });
    Object.assign(enrollment, { schemaId: top.id, x: 40, y: 60 + tableHeight(student) + 20 });
    const layout = reflowDiagram(schema);
    const grownBy = tableHeight(student, "document") - tableHeight(student);
    expect(grownBy).toBeGreaterThan(0);
    expect(layout.tables.get(enrollment.id)!.y).toBe(enrollment.y + grownBy);
    const grown = layout.groups.find((group) => group.id === top.id)!;
    expect(grown.height).toBeGreaterThan(top.height);
    expect(layout.groups.find((group) => group.id === below.id)!.y).toBe(below.y + (grown.height - top.height));
  });

  it("pushes a memo inside a group down with the card above it", () => {
    const schema = makeDemoSchema();
    const [student] = schema.tables;
    const group = { ...makeSchemaGroup("Top", 0, 0), id: "g_top", height: 900 };
    schema.groups = [group];
    Object.assign(student, { schemaId: group.id, x: 40, y: 60, comment: "Every student ever enrolled, including the ones who have since left the school entirely." });
    schema.tables = [student];
    const memo = { ...makeMemo("seed rows", 40, 60 + tableHeight(student) + 16), id: "memo_1", schemaId: group.id };
    schema.memos = [memo];
    const layout = reflowDiagram(schema);
    expect(layout.memos[0].y).toBe(memo.y + tableHeight(student, "document") - tableHeight(student));
  });

  it("opens with the diagram's title, a summary and a legend", () => {
    const svg = renderDiagramSVG(normalizeRelationships(makeDemoSchema()));
    expect(svg).toContain(">Oracle PL/SQL Workspace</text>");
    expect(svg).toContain("2 tables · 1 relationship");
    expect(svg).toContain("Foreign key (many → one)");
  });

  it("for the Document, ends with a key under the diagram and leaves the name out", () => {
    const svg = renderDiagramSVG(normalizeRelationships(makeDemoSchema()), { key: "bottom" });
    expect(svg).not.toContain(">Oracle PL/SQL Workspace</text>");
    expect(svg).toContain("2 tables · 1 relationship");
    expect(svg).toContain("Foreign key (many → one)");
    const y = (label: string) => Number(svg.match(new RegExp(`<text x="[\\d.-]+" y="([\\d.-]+)"[^>]*>${label}<`))?.[1]);
    expect(y("Primary key")).toBeGreaterThan(y("enrollment"));
    expect(y("Primary key")).toBeGreaterThan(y("student"));
  });
});
