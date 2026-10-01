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

  it("starts at the beginning when the open text is not in the book", () => {
    expect(nextMatch(parts, "missing", 4, query("cat"))).toEqual({ id: "preface", from: 2, to: 5 });
    expect(previousMatch(parts, "missing", 0, query("cat"))).toEqual({ id: "inward", from: 22, to: 25 });
    expect(previousMatch([{ id: "only", text: "xx cat yy" }], "only", 0, query("cat"))).toEqual({ id: "only", from: 3, to: 6 });
  });

  it("returns nothing for an empty or invalid query", () => {
    expect(nextMatch(parts, "naming", 0, query(""))).toBeNull();
    expect(nextMatch(parts, "naming", 0, query("[", { regexp: true }))).toBeNull();
    expect(previousMatch([], "naming", 0, query("cat"))).toBeNull();
  });

  it("finds a match that starts at the first character", () => {
    const one: FindPart[] = [{ id: "only", text: "cat sits\n" }];
    const end = one[0].text.length;
    expect(nextMatch(one, "only", end, query("cat"))).toEqual({ id: "only", from: 0, to: 3 });
    expect(previousMatch(one, "only", end, query("cat"))).toEqual({ id: "only", from: 0, to: 3 });
    expect(nextMatch(one, "missing", 4, query("cat"))).toEqual({ id: "only", from: 0, to: 3 });
  });

  it("leaves the match the cursor is sitting on", () => {
    const text = "cat and cat";
    const second = text.lastIndexOf("cat");
    expect(previousMatch([{ id: "only", text }], "only", second, query("cat"))).toEqual({ id: "only", from: 0, to: 3 });
  });

  it("moves from the first text to a match at the start of a later one", () => {
    const book: FindPart[] = [
      { id: "preface", text: "cat in front\n" },
      { id: "end", text: "cat in back\n" },
    ];
    expect(nextMatch(book, "preface", book[0].text.length, query("cat"))).toEqual({ id: "end", from: 0, to: 3 });
  });

  it("wraps to a match at the start of an earlier text", () => {
    const book: FindPart[] = [
      { id: "preface", text: "cat in front\n" },
      { id: "end", text: "nothing here\n" },
    ];
    expect(nextMatch(book, "end", 0, query("cat"))).toEqual({ id: "preface", from: 0, to: 3 });
    expect(previousMatch(book, "end", 0, query("cat"))).toEqual({ id: "preface", from: 0, to: 3 });
  });

  it("keeps searching when the last text has no match", () => {
    const book: FindPart[] = [
      { id: "open", text: "plain\n" },
      { id: "middle", text: "cat here\n" },
      { id: "last", text: "plain\n" },
    ];
    expect(previousMatch(book, "open", 0, query("cat"))).toEqual({ id: "middle", from: 0, to: 3 });
  });

  it("does not stay on an empty match at the cursor", () => {
    const book: FindPart[] = [
      { id: "open", text: "hello" },
      { id: "next", text: "there" },
    ];
    expect(nextMatch(book, "open", book[0].text.length, query("$", { regexp: true }))).toEqual({
      id: "next",
      from: 5,
      to: 5,
    });
  });
});
