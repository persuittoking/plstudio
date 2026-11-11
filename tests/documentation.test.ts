import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applySchemaToYDoc, migrateLegacyDocumentation, schemaFromYDoc } from "@/app/lib/collab/ydoc";
import { columnRules, diagramSources, documentTemplate, inline, parseDocument, renderDocument } from "@/app/lib/documentation";
import { makeColumn, makeEmptySchema, makeMemo, makeTable, normalizeRelationships, type Schema } from "@/app/lib/schema";
import { exportSchemaJson, parseSchemaJson } from "@/app/lib/schema-json";

const schema = (): Schema => {
  const grids = makeTable("CORE_GRIDS", 0, 0);
  grids.columns = [makeColumn({ name: "GRID_CODE", size: "50", unique: true, notNull: true })];
  const actions = makeTable("CORE_GRID_ACTIONS", 0, 0);
  actions.comment = "Grid tugmalari";
  actions.columns = [
    makeColumn({ name: "GRID_CODE", size: "50", pk: true, fk: { tableId: grids.id, columnId: grids.columns[0].id }, comment: "Qaysi grid" }),
    makeColumn({ name: "ORDER_BY", type: "NUMBER", size: "3", defaultValue: "10" }),
  ];
  const next = normalizeRelationships({ ...makeEmptySchema("Grid row actions v3"), tables: [grids, actions], relationships: [] });
  next.relationships = next.relationships!.map((rel) => ({ ...rel, name: "FK grid_code", deleteConstraint: "Cascade" }));
  return next;
};
const render = (source: string, input = schema()) => renderDocument(input, source, { theme: "dark", diagrams: new Map(), generatedAt: "2026-10-23" }).body;

describe("parseDocument", () => {
  it("reads every block kind", () => {
    const blocks = parseDocument([
      "^ CMS · grid", "# Title", "", "Para one", "continues here.", "", "> note", "", "- a", "- b", "", "1. x", "",
      "| A | B |", "|---|---|", "| 1 | 2 |", "", ":::cards", "### Grid", "`KEY`", "text", ":::", "", ":::stats", "### 21 | Tugmalar", ":::",
      "", "```sql", "select 1", "```", "", "{{er}}", "{{columns core_grids}}", "{{tables}}", "{{relationships}}", "---",
    ].join("\n"));
    expect(blocks.map((block) => block.type)).toEqual(["kicker", "heading", "paragraph", "note", "list", "list", "table", "cards", "cards", "code", "er", "columns", "tables", "relationships", "rule"]);
    expect(blocks[2]).toEqual({ type: "paragraph", text: "Para one continues here." });
    expect(blocks[6]).toEqual({ type: "table", headers: ["A", "B"], rows: [["1", "2"]] });
    expect(blocks[7]).toEqual({ type: "cards", stats: false, cards: [{ title: "Grid", lines: ["`KEY`", "text"] }] });
    expect(blocks[11]).toEqual({ type: "columns", table: "core_grids" });
  });
});

describe("inline", () => {
  it("formats code, bold and badges, and escapes everything else", () => {
    expect(inline("`a<b>` **x** [[+YANGI]] [[-v2]] [[BOR]] <script>")).toBe(
      `<code>a&lt;b&gt;</code> <strong>x</strong> <span class="badge good">YANGI</span> <span class="badge bad">v2</span> <span class="badge">BOR</span> &lt;script&gt;`);
  });
  it("leaves code alone", () => expect(inline("`**not bold**`")).toBe("<code>**not bold**</code>"));
});

describe("renderDocument", () => {
  it("fills a table's columns from the schema", () => {
    const body = render("{{columns CORE_GRID_ACTIONS}}");
    ["USTUN", "Ustun", "Tur", "Qoida", "Vazifasi"].slice(1).forEach((header) => expect(body).toContain(`<th>${header}</th>`));
    expect(body).toMatch(/PK, FK <code class="table-ref" style="--table:#[0-9a-f]{6}">CORE_GRIDS\(GRID_CODE\)<\/code> on delete cascade/);
    expect(body).toContain("default <code>10</code>");
    expect(body).toContain("Qaysi grid");
  });
  it("says so when a table does not exist", () => expect(render("{{columns NOPE}}")).toContain("Jadval topilmadi"));
  it("lists relationships with their rules", () => {
    const body = render("{{relationships}}");
    expect(body).toContain("FK grid_code");
    expect(body).toContain("<td>cascade</td>");
  });
  it("draws the ER diagram as it is on the canvas, sized by the page", async () => {
    const { canvasDiagram } = await import("@/app/lib/documentation");
    const { renderDiagramSVG } = await import("@/app/components/designer/diagram-svg");
    const input = schema();
    const diagram = canvasDiagram(input, "dark");
    const open = renderDiagramSVG(input, { theme: "dark" }).match(/^<svg\b[^>]*>/)![0];
    expect(diagram.width).toBe(Number(open.match(/ width="([\d.]+)"/)![1]));
    expect(diagram.markup.match(/^<svg\b[^>]*>/)![0]).not.toMatch(/ (width|height)=/);
    const body = renderDocument(input, "{{er}}", { theme: "dark", diagrams: new Map(), generatedAt: "" }).body;
    expect(body).toContain(`<figure class="diagram er-figure"><svg width="${Math.ceil(diagram.width)}"`);
    expect(body).toContain("CORE_GRID_ACTIONS");
  });
  it("asks only for the user's Mermaid blocks, once each", () => {
    const sources = diagramSources(schema(), parseDocument("{{er}}\n```mermaid\nflowchart LR\n  A-->B\n```\n```mermaid\nflowchart LR\n  A-->B\n```"));
    expect(sources).toEqual(["flowchart LR\n  A-->B"]);
  });
});

describe("documentTemplate", () => {
  it("drafts every section with the schema blocks in place", () => {
    const input = { ...schema(), memos: [makeMemo("Muhim izoh")] };
    const text = documentTemplate(input);
    ["# Grid row actions v3", "{{er}}", "{{columns CORE_GRIDS}}", "{{columns CORE_GRID_ACTIONS}}", "{{relationships}}", "```mermaid", "> Muhim izoh"].forEach((part) => expect(text).toContain(part));
    expect(render(text, input)).not.toContain("Jadval topilmadi");
  });
});

describe("columnRules", () => {
  it("puts keys first and spells out NOT NULL and UK", () => {
    const input = schema();
    expect(columnRules(input, input.tables[0], input.tables[0].columns[0])).toBe("UK, NOT NULL");
  });
});

describe("saving the document", () => {
  it("survives the collaborative document", () => {
    const input = { ...schema(), documentation: "# Hujjat" };
    const ydoc = new Y.Doc();
    applySchemaToYDoc(ydoc, input);
    expect(schemaFromYDoc(ydoc).documentation).toBe("# Hujjat");
    applySchemaToYDoc(ydoc, { ...input, documentation: undefined });
    expect(schemaFromYDoc(ydoc).documentation).toBeUndefined();
  });
  it("merges two people typing in different paragraphs at once", () => {
    const base = { ...schema(), documentation: "# Hujjat\n\nBirinchi.\n\nIkkinchi.\n" };
    const a = new Y.Doc();
    applySchemaToYDoc(a, base);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applySchemaToYDoc(a, { ...base, documentation: base.documentation.replace("Birinchi", "A: birinchi") });
    applySchemaToYDoc(b, { ...base, documentation: base.documentation.replace("Ikkinchi", "B: ikkinchi") });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(schemaFromYDoc(a).documentation).toBe("# Hujjat\n\nA: birinchi.\n\nB: ikkinchi.\n");
    expect(schemaFromYDoc(b).documentation).toBe(schemaFromYDoc(a).documentation);
  });
  it("reads a document saved as one string, and moves it into the text once", () => {
    const ydoc = new Y.Doc();
    applySchemaToYDoc(ydoc, schema());
    ydoc.getMap("meta").set("documentation", "# Eski");
    expect(schemaFromYDoc(ydoc).documentation).toBe("# Eski");
    migrateLegacyDocumentation(ydoc);
    migrateLegacyDocumentation(ydoc);
    expect(ydoc.getMap("meta").has("documentation")).toBe(false);
    expect(ydoc.getText("documentation").toString()).toBe("# Eski");
  });
  it("survives a JSON export and import", () => {
    const result = parseSchemaJson(exportSchemaJson({ ...schema(), documentation: "# Hujjat" }));
    expect(result.schema?.documentation).toBe("# Hujjat");
  });
});

describe("languages", () => {
  it("stores the language as a line, and Uzbek as none", async () => {
    const { documentLanguage, withLanguage, withoutLanguage } = await import("@/app/lib/document-i18n");
    expect(withLanguage("uz", "# Hujjat\n")).toBe("# Hujjat\n");
    const russian = withLanguage("ru", "# Документ\n");
    expect(russian).toBe("{{lang ru}}\n\n# Документ\n");
    expect(documentLanguage(russian)).toBe("ru");
    expect(withoutLanguage(russian)).toBe("# Документ\n");
    expect(documentLanguage("# no line")).toBe("uz");
  });

  it("writes the schema blocks' headings in the document's language", () => {
    const input = schema();
    const html = (lang: string) => renderDocument(input, `{{lang ${lang}}}\n\n{{columns CORE_GRID_ACTIONS}}\n\n{{relationships}}`, { theme: "light", diagrams: new Map(), generatedAt: "" });
    expect(html("ru").body).toContain("<th>Назначение</th>");
    expect(html("ru").body).toContain("многие → один");
    expect(html("en").body).toContain("<th>Purpose</th>");
    expect(html("en").lang).toBe("en");
    expect(render("{{columns CORE_GRID_ACTIONS}}")).toContain("<th>Vazifasi</th>");
    // The language line is not content.
    expect(parseDocument("{{lang ru}}\n\n# A")).toEqual([{ type: "heading", level: 1, text: "A" }]);
  });

  it("drafts the template in each language", async () => {
    const { pageStrings } = await import("@/app/lib/document-i18n");
    expect(documentTemplate(schema(), "ru")).toContain("## ER-диаграмма");
    expect(documentTemplate(schema(), "en")).toMatch(/### \*\*==\{#[0-9a-f]{6}\}CORE_GRIDS==\*\* columns/);
    expect(pageStrings("ru").columnsHeading("T")).toBe("Столбцы `T`");
  });
});

describe("highlights and callouts", () => {
  it("renders ==highlights== in four colours", () => {
    expect(inline("==a== ==+b== ==~c== ==-d==")).toBe(`<mark class="hl yellow">a</mark> <mark class="hl green">b</mark> <mark class="hl blue">c</mark> <mark class="hl pink">d</mark>`);
  });
  it("colours words with !!…!!, and nests inside a highlight", () => {
    expect(inline("!!a!! !!+b!! !!~c!! !!-d!!")).toBe(`<span class="tc yellow">a</span> <span class="tc green">b</span> <span class="tc blue">c</span> <span class="tc pink">d</span>`);
    expect(inline("==!!-x!!==")).toBe(`<mark class="hl yellow"><span class="tc pink">x</span></mark>`);
  });
  it("reads !> as a callout, not a note", () => {
    expect(parseDocument("!> **Eng muhimi:** bitta fikr\n\n> izoh")).toEqual([{ type: "callout", tone: "", text: "**Eng muhimi:** bitta fikr" }, { type: "note", color: "", text: "izoh" }]);
    expect(render("!> Muhim")).toContain(`<p class="callout">Muhim</p>`);
  });
});

describe("language versions", () => {
  it("keeps one version per language and finds each", async () => {
    const { setVersion, splitVersions, versionText, documentLanguage, hasVersion } = await import("@/app/lib/document-i18n");
    let text = "# Hujjat\n";
    expect(splitVersions(text)).toEqual({ order: ["uz"], texts: { uz: "# Hujjat\n" } });
    text = setVersion(text, "ru", "# Документ\n");
    expect(text).toBe("{{lang uz}}\n\n# Hujjat\n\n{{lang ru}}\n\n# Документ\n");
    expect(versionText(text, "ru")).toBe("# Документ\n");
    expect(versionText(text, "uz")).toBe("# Hujjat\n");
    expect(documentLanguage(text)).toBe("uz");
    expect(hasVersion(text, "en")).toBe(false);
    expect(setVersion(text, "uz", "# Yangi\n")).toBe("{{lang uz}}\n\n# Yangi\n\n{{lang ru}}\n\n# Документ\n");
    // A document saved before versions existed is its own single version.
    expect(splitVersions("{{lang ru}}\n\n# A\n")).toEqual({ order: ["ru"], texts: { ru: "# A\n" } });
  });
  it("renders the version asked for", () => {
    const text = "{{lang uz}}\n\n# Hujjat\n\n{{lang ru}}\n\n# Документ\n";
    const body = (lang?: "uz" | "ru") => renderDocument(schema(), text, { theme: "light", diagrams: new Map(), generatedAt: "", lang }).body;
    expect(body("ru")).toContain("<h1>Документ</h1>");
    expect(body("ru")).not.toContain("Hujjat</h1>");
    expect(body()).toContain("<h1>Hujjat</h1>");
  });
  it("starts the draft lively: highlights, badges, coloured table names and a callout, in every language", async () => {
    const { withLanguage } = await import("@/app/lib/document-i18n");
    for (const lang of ["uz", "ru", "en"] as const) {
      const html = renderDocument(schema(), withLanguage(lang, documentTemplate(schema(), lang)), { theme: "dark", diagrams: new Map(), generatedAt: "", lang }).body;
      expect(html, lang).toContain('<mark class="hl yellow">');
      expect(html, lang).toContain('<span class="badge good">');
      expect(html, lang).toContain('<span class="tc custom" style="color:');
      expect(html, lang).toContain('<p class="callout">');
    }
  });
});

describe("the document's ER lines", () => {
  it("run straight with right-angle turns, as on the canvas; the Image export keeps its curves", async () => {
    const { renderDiagramSVG } = await import("@/app/components/designer/diagram-svg");
    const { canvasDiagram } = await import("@/app/lib/documentation");
    const paths = (svg: string) => [...svg.matchAll(/<path d="(M [^"]+)" fill="none" stroke="[^"]+" stroke-width="1.3"/g)].map((match) => match[1]);
    const straight = paths(canvasDiagram(schema(), "light").markup);
    expect(straight.length).toBeGreaterThan(0);
    straight.forEach((d) => expect(d).toMatch(/^M [\d.-]+ [\d.-]+ (H|L) /));
    straight.forEach((d) => expect(d).not.toMatch(/ C /));
    paths(renderDiagramSVG(schema(), { theme: "light" })).forEach((d) => expect(d).toMatch(/ C /));
  });
});

describe("callout kinds", () => {
  it("reads a sign after !> as the kind, and leaves plain callouts blue", () => {
    expect(parseDocument("!>+ Maslahat\n\n!>! Diqqat\n\n!>- Xavf\n\n!> Oddiy").map((block) => block.type === "callout" && block.tone))
      .toEqual(["tip", "warning", "danger", ""]);
    expect(render("!>! Diqqat")).toContain(`<p class="callout callout-warning">Diqqat</p>`);
  });

  it("survives the editor and back", async () => {
    const { fromTiptap, toTiptap } = await import("@/app/lib/document-tiptap");
    const text = "!>+ Maslahat\n\n!>! Diqqat\n\n!>- Xavf\n\n!> Oddiy";
    expect(fromTiptap(toTiptap(text)).trim()).toBe(text);
  });
});

describe("note colours", () => {
  it("reads a colour code after >, and keeps the default without one", async () => {
    expect(parseDocument(">{#16A34A} yashil\n\n> oddiy")).toEqual([{ type: "note", color: "#16a34a", text: "yashil" }, { type: "note", color: "", text: "oddiy" }]);
    expect(render(">{#16a34a} yashil")).toContain(`<p class="note" style="--note:#16a34a">yashil</p>`);
    expect(render("> oddiy")).toContain(`<p class="note">oddiy</p>`);
    const { fromTiptap, toTiptap } = await import("@/app/lib/document-tiptap");
    expect(fromTiptap(toTiptap(">{#16a34a} yashil\n\n> oddiy")).trim()).toBe(">{#16a34a} yashil\n\n> oddiy");
  });
});

describe("table colours", () => {
  it("draws a table named in code in its card's colour, and stripes its column table", () => {
    const input = schema();
    const color = input.tables.find((table) => table.name === "CORE_GRIDS")!.color.a.toLowerCase();
    const body = render("### `CORE_GRIDS` ustunlari\n\n`core_grids`, `NOT_A_TABLE`\n\n{{columns CORE_GRIDS}}", input);
    expect(body).toContain(`<h3><code class="table-ref" style="--table:${color}">CORE_GRIDS</code> ustunlari</h3>`);
    expect(body).toContain(`<code class="table-ref" style="--table:${color}">core_grids</code>`);
    expect(body).toContain("<code>NOT_A_TABLE</code>");
    expect(body).toContain(`<div class="table columns" style="--table:${color}">`);
  });
});
