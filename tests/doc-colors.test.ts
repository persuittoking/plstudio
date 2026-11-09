import { describe, expect, it } from "vitest";
import { colorOfTone, parseHexColor, toneOfColor } from "@/app/lib/doc-colors";
import { inline } from "@/app/lib/documentation";
import { inlineNodes, inlineText } from "@/app/lib/document-tiptap";

describe("colours by code", () => {
  it("reads and writes tones: theme colours by sign, any other by code", () => {
    expect(colorOfTone("")).toBe("yellow");
    expect(colorOfTone("~")).toBe("blue");
    expect(colorOfTone("{#FF8800}")).toBe("#ff8800");
    expect(toneOfColor("pink")).toBe("-");
    expect(toneOfColor("#ff8800")).toBe("{#ff8800}");
    expect(toneOfColor("nonsense")).toBe("");
  });

  it("accepts a code with or without # and in short form", () => {
    expect(parseHexColor("ff8800")).toBe("#ff8800");
    expect(parseHexColor(" #F80 ")).toBe("#ff8800");
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("red")).toBeNull();
  });

  it("paints a coded colour on the page, and keeps theme colours as classes", () => {
    expect(inline("=={#ff8800}a== !!{#0055aa}b!! ==+c==")).toBe(
      `<mark class="hl custom" style="background:#ff880059">a</mark> <span class="tc custom" style="color:#0055aa">b</span> <mark class="hl green">c</mark>`);
  });

  it("keeps a yellow mark yellow when its words start like a tone", () => {
    for (const mark of ["highlight", "textColor"] as const) {
      const source = inlineText([{ type: "text", text: "-1", marks: [{ type: mark, attrs: { color: "yellow" } }] }]);
      expect(inlineNodes(source)).toEqual([{ type: "text", text: "-1", marks: [{ type: mark, attrs: { color: "yellow" } }] }]);
    }
    expect(inline("=={yellow}+998==")).toBe(`<mark class="hl yellow">+998</mark>`);
  });

  it("keeps = and ! inside marked words", () => {
    for (const source of ["!!Warning!!!", "==a = b==", "==!!-Stop!!!==", "!!x != y!!"]) expect(inlineText(inlineNodes(source))).toBe(source);
    expect(inlineNodes("!!Warning!!!")[0].text).toBe("Warning!");
    expect(inline("!!Warning!!!")).toBe(`<span class="tc yellow">Warning!</span>`);
  });

  it("survives the editor and back, nested too", () => {
    const source = "Oddiy =={#ff8800}to'q sariq== va !!{#6366f1}indigo!!, ==!!{#ef4444}ikkalasi!!== ham.";
    const nodes = inlineNodes(source);
    expect(nodes.find((node) => node.text === "to'q sariq")?.marks).toEqual([{ type: "highlight", attrs: { color: "#ff8800" } }]);
    expect(inlineText(nodes)).toBe(source);
  });
});

describe("badge colours", () => {
  it("draws a badge in any colour, and keeps the three tones", () => {
    expect(inline("[[BOR]] [[+YANGI]] [[-v2]] [[{#F97316}TEZ]]")).toBe(
      `<span class="badge">BOR</span> <span class="badge good">YANGI</span> <span class="badge bad">v2</span> <span class="badge custom" style="--badge:#f97316">TEZ</span>`);
  });

  it("survives the editor and back", () => {
    const source = "Holat: [[{#f97316}TEZ]], [[+YANGI]] va [[BOR]].";
    const nodes = inlineNodes(source);
    expect(nodes.find((node) => node.text === "TEZ")?.marks).toEqual([{ type: "badge", attrs: { tone: "#f97316" } }]);
    expect(inlineText(nodes)).toBe(source);
  });
});
