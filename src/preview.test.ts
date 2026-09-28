import { describe, expect, it } from "vitest";
import type { TreeNode } from "./model";
import { renderSection } from "./preview";

function section(body: string, role: TreeNode["header"]["role"] = "body"): TreeNode {
  return {
    kind: "section",
    header: { id: "inward", title: "Inward", synopsis: "", status: "draft", role },
    body,
    prefix: "010",
    slug: "inward",
    dir: "",
    entryName: "010-inward.md",
    children: [],
  };
}

describe("preview", () => {
  it("shows the section the way export will, including a missing note and a broken fence", () => {
    const parent: TreeNode = {
      kind: "group",
      header: { id: "rule", title: "The Rule", synopsis: "", status: "draft", role: "body" },
      body: "",
      prefix: "010",
      slug: "rule",
      dir: "",
      entryName: "010-rule",
      children: [],
    };
    const grand: TreeNode = {
      kind: "group",
      header: { id: "naming", title: "Naming", synopsis: "", status: "draft", role: "body" },
      body: "",
      prefix: "010",
      slug: "naming",
      dir: "",
      entryName: "010-naming",
      children: [parent],
    };
    const node = section("# Where the rule stops\n\nSee.[^9]\n\n```java\nclass Foo {\n");
    const rendered = renderSection(node, [grand, parent]);
    expect(rendered.html).toContain("<h3>Inward</h3>");
    expect(rendered.html).toContain("<h4>Where the rule stops</h4>");
    expect(rendered.html).toContain("missing-fn");
    expect(rendered.html).toContain("broken-fence");
    expect(rendered.html).toContain("Foo");
    expect(rendered.warnings.some((warning) => warning.includes("[^9]"))).toBe(true);
    expect(rendered.warnings.some((warning) => warning.includes("Unclosed"))).toBe(true);
  });

  it("does not treat a footnote mentioned in code as a missing note", () => {
    const rendered = renderSection(
      section("A footnote is `[^1]`, and the command inserts `[^n]`.\n"),
      [],
    );
    expect(rendered.warnings).toEqual([]);
    expect(rendered.html).not.toContain("missing-fn");
  });

  it("labels a front-matter section", () => {
    const rendered = renderSection(section("A preface.\n", "front"), []);
    expect(rendered.html).toContain('class="rendered-section front"');
    expect(rendered.html).toContain("Front matter");
    expect(rendered.html).toContain("<h1>Inward</h1>");
  });
});
