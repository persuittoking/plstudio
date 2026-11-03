import { describe, expect, it } from "vitest";
import { detectLanguage, highlightCode } from "@/app/lib/code-highlight";
import { makeDemoSchema } from "@/app/lib/schema";
import { renderDocument } from "@/app/lib/documentation";

describe("code language detection", () => {
  it.each([
    ["select id, name from users where id = :id;", "sql"],
    ["create or replace package body core_grid is\n  procedure save(p_id number) is\n  begin\n    null;\n  end;\nend core_grid;", "sql"],
    ["CREATE TABLE talaba (\n  id NUMBER NOT NULL\n);", "sql"],
    ["l_total := l_total + 1;", "sql"],
    ["const total = items.reduce((sum, item) => sum + item.price, 0);\nexport type Item = { price: number };", "typescript"],
    ["function add(a, b) {\n  return a + b;\n}", "javascript"],
    ["public class Main {\n  public static void main(String[] args) {}\n}", "java"],
    ['{\n  "name": "daftar"\n}', "json"],
    ['<div class="card">\n  <span>Hi</span>\n</div>', "xml"],
    ["pnpm install\ncd daftar && pnpm dev --host", "bash"],
    ["def total(items):\n    return sum(items)", "python"],
    [".card {\n  color: red;\n}", "css"],
    ["just some words here", ""],
    ["", ""],
  ])("%s → %s", (code, language) => expect(detectLanguage(code)).toBe(language));

  it("highlights with the detected language and escapes plain text", () => {
    expect(highlightCode("select 1 from dual").html).toContain('class="hljs-keyword"');
    expect(highlightCode("a < b & c")).toEqual({ html: "a &lt; b &amp; c", language: "" });
  });

  it("labels and colours code on the rendered page", () => {
    const { body, css } = renderDocument(makeDemoSchema(), "```\nselect id from users;\n```", { theme: "dark", diagrams: new Map(), generatedAt: "" });
    expect(body).toContain('<pre class="code" data-lang="SQL"><code class="hljs language-sql">');
    expect(body).toContain('<span class="hljs-keyword">select</span>');
    expect(css).toContain("--syn-keyword:#ff7b72");
  });
});
