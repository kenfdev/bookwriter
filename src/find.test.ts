import { SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";
import { nextMatch, previousMatch, type FindPart } from "./find";

const parts: FindPart[] = [
  { id: "preface", text: "A cat in the preface.\n" },
  { id: "naming", text: "Before the word.\n\nNo animal here.\n" },
  { id: "inward", text: "The cat sat.\n\nAnother cat.\n" },
];

function query(search: string, options: { caseSensitive?: boolean; wholeWord?: boolean; regexp?: boolean } = {}): SearchQuery {
  return new SearchQuery({ search, ...options });
}

describe("find across texts", () => {
  it("continues into the next text and wraps to the first", () => {
    expect(nextMatch(parts, "naming", 0, query("cat"))).toEqual({ id: "inward", from: 4, to: 7 });
    const atEnd = "The cat sat.\n\nAnother cat.\n".length;
    expect(nextMatch(parts, "inward", atEnd, query("cat"))).toEqual({ id: "preface", from: 2, to: 5 });
  });

  it("stays in the open text when another match follows the cursor", () => {
    const afterFirst = "The cat sat.\n".length;
    expect(nextMatch(parts, "inward", afterFirst, query("cat"))).toEqual({ id: "inward", from: 22, to: 25 });
  });

  it("walks backward and wraps to the last text", () => {
    expect(previousMatch(parts, "inward", 4, query("cat"))).toEqual({ id: "preface", from: 2, to: 5 });
    expect(previousMatch(parts, "preface", 0, query("cat"))).toEqual({ id: "inward", from: 22, to: 25 });
  });

  it("honors case and whole words", () => {
    expect(nextMatch(parts, "naming", 0, query("Cat", { caseSensitive: true }))).toBeNull();
    expect(nextMatch(parts, "naming", 0, query("cat", { wholeWord: true }))).toEqual({ id: "inward", from: 4, to: 7 });
    expect(nextMatch([{ id: "naming", text: "category\n" }], "naming", 0, query("cat", { wholeWord: true }))).toBeNull();
  });

  it("returns nothing for an empty or invalid query", () => {
    expect(nextMatch(parts, "naming", 0, query(""))).toBeNull();
    expect(nextMatch(parts, "naming", 0, query("[", { regexp: true }))).toBeNull();
    expect(previousMatch([], "naming", 0, query("cat"))).toBeNull();
  });
});
