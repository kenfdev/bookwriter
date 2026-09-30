import { describe, expect, it } from "vitest";
import { COMMANDS, applyCommand, latestLanguage } from "./commands";

describe("markup commands", () => {
  it("lists the twelve constructs, and foot finds Footnote", () => {
    expect(COMMANDS.map((command) => command.name)).toEqual([
      "Emphasis",
      "Strong",
      "Inline code",
      "Link",
      "Picture",
      "Subsection",
      "Lower subsection",
      "Bullet list",
      "Numbered list",
      "Quotation",
      "Code block",
      "Footnote",
    ]);
    const foot = COMMANDS.filter((command) => command.name.toLowerCase().includes("foot"));
    expect(foot.map((command) => command.name)).toEqual(["Footnote"]);
    const picture = COMMANDS.filter((command) => command.name.toLowerCase().includes("pic"));
    expect(picture.map((command) => command.name)).toEqual(["Picture"]);
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

    const picture = applyCommand("picture", "See the bridge today.", 8, 14, "", "images/bridge.jpg");
    expect(picture.text).toBe("See the ![bridge](images/bridge.jpg){width=100%} today.");
    expect(picture.head).toBe("See the ![bridge](images/bridge.jpg){width=100%}".length);

    const bare = applyCommand("picture", "See.", 4, 4, "", "images/my photo.jpg");
    expect(bare.text).toBe("See.![](<images/my photo.jpg>){width=100%}");
    expect(bare.head).toBe(6);

    const escaped = applyCommand("picture", "A]b", 0, 3, "", "images/a.jpg");
    expect(escaped.text).toBe("![A\\]b](images/a.jpg){width=100%}");

    const code = applyCommand("inline-code", "x", 1, 1);
    expect(code.text).toBe("x``");
    expect(code.head).toBe(2);
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

    const afterWord = applyCommand("code-block", "See this", 4, 8, "");
    expect(afterWord.text).toBe("See \n\n```\nthis\n```\n\n");

    const afterLine = applyCommand("code-block", "See\nint x;", 4, 10, "java");
    expect(afterLine.text).toBe("See\n\n```java\nint x;\n```\n\n");

    const afterBlank = applyCommand("code-block", "See\n\nint x;", 5, 11, "java");
    expect(afterBlank.text).toBe("See\n\n```java\nint x;\n```\n\n");
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
