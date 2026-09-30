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
    expect(rendered.html).toMatch(/<h4[^>]*>Where the rule stops<\/h4>/);
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

  it("marks each block with the source lines it came from", () => {
    const rendered = renderSection(section("Hello\n\n```\ncode\n```\n"), []);
    expect(rendered.html).toContain('data-id="inward"');
    expect(rendered.html).toContain('data-line="0"');
    expect(rendered.html).toContain("<pre data-line=");
  });

  it("sizes a picture from the width field and does not print that field", () => {
    const rendered = renderSection(section("See the ![Bridge](images/bridge.jpg){width=100%} today.\n"), []);
    expect(rendered.html).toContain('style="width: 100%"');
    expect(rendered.html).toContain('alt="Bridge"');
    expect(rendered.html).toContain("today.");
    expect(rendered.html).not.toContain("{width=100%}");

    const sized = renderSection(section("![Map](images/map.png){width=40% height=8cm}\n"), []);
    expect(sized.html).toContain('style="width: 40%; height: 8cm"');
    expect(sized.html).not.toContain("{width=");
  });

  it("labels a front-matter section", () => {
    const rendered = renderSection(section("A preface.\n", "front"), []);
    expect(rendered.html).toContain('class="rendered-section front"');
    expect(rendered.html).toContain("Front matter");
    expect(rendered.html).toContain("<h1>Inward</h1>");
  });
});
