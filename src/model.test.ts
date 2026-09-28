import { describe, expect, it } from "vitest";
import {
  assignPrefixes,
  nextPrefix,
  parseSection,
  serializeSection,
  slugify,
  uniqueId,
  wordCount,
} from "./model";

const inwardFile = `---
id: inward
title: Inward
synopsis: Source dependencies point inward, toward policy.
status: draft
role: body
---
A dependency points inward.[^1]

# Where the rule stops

\`\`\`java
class Foo {
    void bar() {}
}
\`\`\`

[^1]: Toward higher-level policy.
`;

describe("section files", () => {
  it("keeps the body bytes and writes the header in a fixed order", () => {
    const parsed = parseSection(inwardFile);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.header).toEqual({
      id: "inward",
      title: "Inward",
      synopsis: "Source dependencies point inward, toward policy.",
      status: "draft",
      role: "body",
    });
    expect(parsed.body.startsWith("A dependency points inward.[^1]\n")).toBe(true);
    expect(parsed.body).toContain("class Foo");
    const written = serializeSection(parsed.header, parsed.body);
    expect(parseSection(written).body).toBe(parsed.body);
    expect(written.startsWith("---\nid: inward\ntitle: Inward\n")).toBe(true);
  });

  it("turns carriage returns into line feeds and quotes scalars that need it", () => {
    const parsed = parseSection("---\r\nid: a\r\ntitle: A: B\r\nsynopsis: \"\"\r\nstatus: no\r\nrole: front\r\n---\r\nLine\r\n");
    expect(parsed.header.title).toBe("A: B");
    expect(parsed.body).toBe("Line\n");
    expect(parsed.warnings.some((warning) => warning.includes("Status"))).toBe(true);
    const saved = serializeSection(
      { id: "a", title: "A: B", synopsis: "", status: "idea", role: "front" },
      "Line\n",
    );
    expect(saved).toContain('title: "A: B"');
    expect(saved).toContain('synopsis: ""');
    expect(saved.endsWith("---\nLine\n")).toBe(true);
  });
});

describe("identity and order", () => {
  it("builds a slug and keeps ids unique", () => {
    expect(slugify("The Dependency Rule")).toBe("the-dependency-rule");
    expect(slugify("Don't Stop")).toBe("dont-stop");
    const used = new Set(["inward"]);
    expect(uniqueId("Inward", used)).toBe("inward-2");
    used.add("inward-2");
    expect(uniqueId("Inward", used)).toBe("inward-3");
  });

  it("numbers siblings by tens, widening past 990", () => {
    expect(assignPrefixes(3)).toEqual(["010", "020", "030"]);
    expect(assignPrefixes(99)[98]).toBe("990");
    expect(assignPrefixes(100)[0]).toBe("0010");
    expect(assignPrefixes(100)[99]).toBe("1000");
    expect(nextPrefix(["010", "020"])).toBe("030");
    expect(nextPrefix([])).toBe("010");
  });
});

describe("word count", () => {
  it("counts whitespace-separated words in the body", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  A dependency points inward.[^1]\n")).toBe(4);
  });
});
