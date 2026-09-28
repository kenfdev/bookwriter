import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportBook, transformBody } from "./export";
import { parseSection, type TreeNode } from "./model";

function node(
  kind: TreeNode["kind"],
  header: TreeNode["header"],
  body: string,
  children: TreeNode[] = [],
): TreeNode {
  return {
    kind,
    header,
    body,
    prefix: "010",
    slug: header.id,
    dir: "",
    entryName: "",
    children,
  };
}

describe("export", () => {
  it("matches the manuscript in the spec", () => {
    const spec = readFileSync("bookwriter-spec.md", "utf8");
    const between = (start: string, end: string, fromIndex = 0) => {
      const from = spec.indexOf(start, fromIndex);
      const to = spec.indexOf(end, from);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThan(from);
      return spec.slice(from, to + end.length);
    };
    const exampleStart = spec.indexOf("Export of the example above:");
    const example = between("# Preface {-}", "[^inward-1]: Toward higher-level policy.", exampleStart);
    const inward = parseSection(between("---\nid: inward", "[^1]: Toward higher-level policy.") + "\n");

    const preface = node(
      "section",
      { id: "preface", title: "Preface", synopsis: "", status: "draft", role: "front" },
      "The preface body.\n",
    );
    const inwardNode = node(
      "section",
      { id: "inward", title: "Inward", synopsis: "", status: "draft", role: "body" },
      inward.body,
    );
    const rule = node(
      "group",
      { id: "the-rule", title: "The Rule", synopsis: "", status: "draft", role: "body" },
      "The chapter opener.\n",
      [inwardNode],
    );
    const naming = node(
      "group",
      { id: "naming", title: "Naming", synopsis: "", status: "draft", role: "body" },
      "The part opener.\n",
      [rule],
    );

    const exported = exportBook([preface, naming]);
    expect(exported.warnings).toEqual([]);
    expect(exported.markdown.trimEnd()).toBe(example.trimEnd());
  });

  it("does not prefix a footnote written inside inline code", () => {
    const transformed = transformBody("A footnote is `[^1]`.\n\nSee.[^1]\n\n[^1]: Note.\n", {
      depth: 1,
      sectionId: "editor",
      front: false,
    });
    expect(transformed.text).toContain("`[^1]`");
    expect(transformed.text).toContain("See.[^editor-1]");
  });

  it("leaves headings and footnotes inside fences alone", () => {
    const transformed = transformBody("```\n# Stay\n[^1]\n```\n\nSee.[^1]\n\n[^1]: Note.\n", {
      depth: 2,
      sectionId: "inward",
      front: false,
    });
    expect(transformed.text).toContain("# Stay");
    expect(transformed.text).toContain("[^1]\n```");
    expect(transformed.text).toContain("See.[^inward-1]");
    expect(transformed.text).toContain("[^inward-1]: Note.");
  });

  it("marks an inherited front-matter section unnumbered and clamps a deep heading", () => {
    const child = node(
      "section",
      { id: "preface", title: "Preface", synopsis: "", status: "idea", role: "body" },
      "##### Too deep\n",
    );
    const group = node(
      "group",
      { id: "front-matter", title: "Front", synopsis: "", status: "idea", role: "front" },
      "",
      [child],
    );
    const exported = exportBook([group]);
    expect(exported.markdown).toContain("# Front {-}\n\n## Preface {-}\n\n###### Too deep {-}");
    expect(exported.warnings.some((warning) => warning.includes("level 7"))).toBe(true);
  });
});
