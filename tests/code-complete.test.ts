import { describe, expect, it } from "vitest";
import { collectWords, completions, wordAt } from "@/app/lib/code-complete";
import { makeColumn, makeTable } from "@/app/lib/schema";

const grid = makeTable("CORE_GRID_ACTIONS", 0, 0);
grid.columns.push(makeColumn({ name: "GRID_CODE" }), makeColumn({ name: "PROCESS_CODE" }));
const source = { schema: { tables: [grid] }, words: ["Core_Grid_Actions.Build", "table_cross.js"], language: "sql" };
const labels = (line: string, language = "sql") => completions(line, { ...source, language }).map((item) => item.label);

describe("code completion", () => {
  it("reads the word before the cursor, with what precedes a dot", () => {
    expect(wordAt("select GRID_CO")).toEqual({ owner: "", prefix: "GRID_CO" });
    expect(wordAt("from CORE_GRID_ACTIONS.")).toEqual({ owner: "CORE_GRID_ACTIONS", prefix: "" });
    expect(wordAt("x := ")).toEqual({ owner: "", prefix: "" });
  });

  it("offers tables first, then columns, words and keywords", () => {
    expect(labels("CORE")).toEqual(["CORE_GRID_ACTIONS", "Core_Grid_Actions.Build"]);
    expect(labels("select GRI")).toEqual(["GRID_CODE"]);
    expect(labels("PRO")).toEqual(["PROCESS_CODE", "PROCEDURE"]);
  });

  it("lists a table's columns after its name and a dot, whatever the case", () => {
    expect(labels("where core_grid_actions.")).toEqual(["ID", "GRID_CODE", "PROCESS_CODE", "Build"]);
    expect(labels("Core_Grid_Actions.Bu")).toEqual(["Build"]);
  });

  it("writes SQL keywords in the case they are typed in", () => {
    expect(labels("sel")).toEqual(["select"]);
    expect(labels("SEL")).toEqual(["SELECT"]);
    expect(labels("cons", "typescript")).toEqual(["const", "console"]);
  });

  it("stays quiet for one letter and for a finished word", () => {
    expect(labels("s")).toEqual([]);
    expect(labels("select")).toEqual([]);
  });

  it("collects identifiers of four letters or more", () => {
    expect(collectWords("call Core_Grid_Actions.Build(p_id); set x = 1")).toEqual(["call", "Core_Grid_Actions.Build", "p_id"]);
  });
});
