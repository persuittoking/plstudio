import { describe, expect, it } from "vitest";
import { applySplice, rebaseText, spliceOf } from "@/app/lib/text-merge";

describe("spliceOf", () => {
  it.each([["abc", "abc"], ["", "x"], ["abc", ""], ["hello world", "hello brave world"], ["aaaa", "aa"], ["abcabc", "abXabc"]])("turns %j into %j", (before, after) =>
    expect(applySplice(before, spliceOf(before, after))).toBe(after));
  it("is the smallest stretch", () => expect(spliceOf("# Title\nbody", "# Title\nnew body")).toEqual({ at: 8, remove: 0, insert: "new " }));
});

describe("rebaseText", () => {
  const base = "# Doc\n\nFirst paragraph.\n\nSecond paragraph.\n";
  it("keeps both edits to separate stretches", () => {
    const mine = base.replace("First", "My first");
    const theirs = base.replace("Second", "Their second");
    expect(rebaseText(base, mine, theirs)).toEqual({ text: "# Doc\n\nMy first paragraph.\n\nTheir second paragraph.\n", conflict: false });
    expect(rebaseText(base, theirs, mine)).toEqual({ text: "# Doc\n\nMy first paragraph.\n\nTheir second paragraph.\n", conflict: false });
  });
  it("takes theirs when nothing was typed here, and mine when nothing changed there", () => {
    expect(rebaseText(base, base, "x")).toEqual({ text: "x", conflict: false });
    expect(rebaseText(base, "y", base)).toEqual({ text: "y", conflict: false });
  });
  it("says so when both edited the same stretch, and keeps mine", () =>
    expect(rebaseText(base, base.replace("First", "One"), base.replace("First", "Two"))).toEqual({ text: base.replace("First", "One"), conflict: true }));
});
