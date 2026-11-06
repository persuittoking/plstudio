import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromTiptap, inlineNodes, inlineText, toTiptap } from "@/app/lib/document-tiptap";
import { documentTemplate, parseDocument } from "@/app/lib/documentation";
import { makeDemoSchema } from "@/app/lib/schema";
import { pageStrings } from "@/app/lib/document-i18n";

const example = readFileSync("tests/fixtures/document-example.md", "utf8");

/** The blocks with code fences' languages left out: the editor writes the language it detects, not the one typed. */
const blocksOf = (text: string) => parseDocument(text).map((block) => (block.type === "code" && block.lang !== "mermaid" ? { ...block, lang: "" } : block));

describe("inline marks", () => {
  it("reads and writes code, badges, bold and italic", () => {
    const source = "Use `GRID_CODE`, [[+YANGI]] and [[-v2]] or [[BOR]], **very** *quiet*.";
    expect(inlineText(inlineNodes(source))).toBe(source);
    expect(inlineNodes("[[+YANGI]]")[0]).toEqual({ type: "text", text: "YANGI", marks: [{ type: "badge", attrs: { tone: "good" } }] });
  });
  it("does not read a multiplication as italic", () => expect(inlineText(inlineNodes("a * b * c"))).toBe("a * b * c"));
  it("reads marks inside italic, and bold italic together", () => {
    expect(inlineNodes("*==x==*")).toEqual([{ type: "text", text: "x", marks: [{ type: "highlight", attrs: { color: "yellow" } }, { type: "italic" }] }]);
    expect(inlineNodes("***x***")).toEqual([{ type: "text", text: "x", marks: [{ type: "italic" }, { type: "bold" }] }]);
    for (const source of ["*==x==* and *!!+y!!*", "a ***both*** b"]) expect(inlineText(inlineNodes(source))).toBe(source);
  });
});

describe("text <-> Tiptap", () => {
  it.each([["the screenshot document", example], ["the starter template", documentTemplate(makeDemoSchema())]])("round-trips %s", (_, source) => {
    const once = fromTiptap(toTiptap(source));
    expect(fromTiptap(toTiptap(once))).toBe(once);
    expect(blocksOf(once)).toEqual(blocksOf(source));
  });

  it("guards a paragraph that would read as another block", () => {
    const text = fromTiptap({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "- not a list" }] }] });
    expect(parseDocument(text)[0].type).toBe("paragraph");
  });

  it("keeps pipes in table cells and drops empty paragraphs", () => {
    const text = fromTiptap({ type: "doc", content: [
      { type: "paragraph" },
      { type: "table", content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Qoida" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "ROW | TOOLBAR" }] }] }] },
      ] },
    ] });
    expect(parseDocument(text)).toEqual([{ type: "table", headers: ["Qoida"], rows: [["ROW | TOOLBAR"]] }]);
  });

  it("gives an empty document one paragraph to type in", () => expect(toTiptap("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] }));
});

describe("ready-made sections", () => {
  it.each(["uz", "ru", "en"] as const)("each converts to editor content and back without loss (%s)", (lang) => {
    const schema = makeDemoSchema();
    Object.entries(pageStrings(lang).sections).forEach(([id, make]) => {
      const source = make(schema);
      const content = toTiptap(source).content ?? [];
      expect(content.length, id).toBeGreaterThan(0);
      expect(blocksOf(fromTiptap({ type: "doc", content })), id).toEqual(blocksOf(source));
    });
  });
});

describe("highlights and callouts in the editor", () => {
  it("round-trips every highlight colour, inside bold too", () => {
    const source = "Keep ==this== and ==+that== and ==~one== and ==-two==, and **==bold mark==**.";
    expect(inlineText(inlineNodes(source))).toBe(source);
    expect(inlineNodes("==~x==")[0]).toEqual({ type: "text", text: "x", marks: [{ type: "highlight", attrs: { color: "blue" } }] });
  });
  it("round-trips coloured words, alone and inside a highlight", () => {
    for (const source of ["Say !!this!! and !!+that!! and !!~one!! and !!-two!!.", "A ==!!-pink word!!== in yellow."]) expect(inlineText(inlineNodes(source))).toBe(source);
    expect(inlineNodes("!!~x!!")[0]).toEqual({ type: "text", text: "x", marks: [{ type: "textColor", attrs: { color: "blue" } }] });
  });
  it("round-trips a callout", () => {
    const text = "!> **Eng muhimi:** bitta fikr\n";
    expect(fromTiptap(toTiptap(text))).toBe(text);
  });
});

describe("code blocks", () => {
  it("write the language their code reads as, whatever the fence said", () => {
    const text = fromTiptap(toTiptap("```java\nselect id from users where id = :id;\n```"));
    expect(text.trim()).toBe("```sql\nselect id from users where id = :id;\n```");
    expect(fromTiptap(toTiptap("```\npublic class Main {\n  public static void main(String[] args) {}\n}\n```"))).toMatch(/^```java\n/);
  });
});
