import { describe, expect, it } from "vitest";
import { COMMANDS, applyCommand, latestLanguage } from "./commands";

describe("markup commands", () => {
  it("lists the eleven constructs, and foot finds Footnote", () => {
    expect(COMMANDS.map((command) => command.name)).toEqual([
      "Emphasis",
      "Strong",
      "Inline code",
      "Link",
      "Subsection",
      "Lower subsection",
      "Bullet list",
      "Numbered list",
      "Quotation",
      "Code block",
      "Footnote",
    ]);
    const query = "foot";
    const found = COMMANDS.filter((command) => command.name.toLowerCase().includes(query));
    expect(found.map((command) => command.name)).toEqual(["Footnote"]);
  });

  it("wraps a selection and parks the cursor inside empty marks", () => {
    const wrapped = applyCommand("emphasis", "word", 0, 4);
    expect(wrapped.text).toBe("*word*");
    expect(wrapped.head).toBe(6);

    const empty = applyCommand("strong", "", 0, 0);
    expect(empty.text).toBe("****");
    expect(empty.head).toBe(2);

    const link = applyCommand("link", "word", 0, 4);
    expect(link.text).toBe("[word](url)");
    expect(link.head).toBe(link.text.length);

    const bare = applyCommand("inline-code", "x", 1, 1);
    expect(bare.text).toBe("x``");
    expect(bare.head).toBe(2);
  });

  it("prefixes the current line", () => {
    const heading = applyCommand("subsection", "hello\nnext", 1, 1);
    expect(heading.text).toBe("# hello\nnext");
    const quote = applyCommand("quotation", "line", 0, 0);
    expect(quote.text).toBe("> line");
    const item = applyCommand("bullet", "line", 2, 2);
    expect(item.text).toBe("- line");
    const numbered = applyCommand("numbered", "line", 0, 0);
    expect(numbered.text).toBe("1. line");
    const lower = applyCommand("lower-subsection", "line", 0, 0);
    expect(lower.text).toBe("## line");
  });

  it("inserts a fenced block using the latest language in the book", () => {
    expect(latestLanguage(["```java\nint x;\n```\n", "```\nplain\n```\n"])).toBe("");
    expect(latestLanguage(["See.\n", "```java\nint x;\n```\n"])).toBe("java");

    const empty = applyCommand("code-block", "", 0, 0, "");
    expect(empty.text).toBe("\n```\n\n```\n\n");
    expect(empty.head).toBe(4);

    const coded = applyCommand("code-block", "int x;", 0, 6, "java");
    expect(coded.text).toBe("\n```java\nint x;\n```\n\n");
    expect(coded.text[coded.head - 1]).toBe(";");
  });

  it("adds the next footnote without renumbering the ones already there", () => {
    const text = "Hello [^1] there.\n\n[^1]: First.\n";
    const edited = applyCommand("footnote", text, text.length, text.length);
    expect(edited.text.startsWith("Hello [^1] there.\n\n[^1]: First.\n")).toBe(true);
    expect(edited.text).toContain("[^2]");
    expect(edited.text.endsWith("[^2]: ")).toBe(true);
    expect(edited.head).toBe(edited.text.length);
  });
});
