import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNode, deleteNode, loadBook, moveNode, planMove, saveNode } from "./book";
import { exportBook } from "./export";
import { filePath, type TreeNode } from "./model";
import { nodeFs } from "./nodeFs";

function tree(): TreeNode[] {
  const section = (id: string): TreeNode => ({
    kind: "section",
    header: { id, title: id, synopsis: "", status: "idea", role: "body" },
    body: "",
    prefix: "010",
    slug: id,
    dir: "",
    entryName: "",
    children: [],
  });
  const group = section("group");
  group.kind = "group";
  group.children = [section("child")];
  return [section("a"), section("b"), group];
}

describe("planMove", () => {
  it("reorders siblings and refuses to drop a group into itself", () => {
    const roots = tree();
    const reordered = planMove(roots, "b", "a", "before");
    expect(reordered).toEqual([{ parentId: null, order: ["b", "a", "group"] }]);

    const into = planMove(roots, "a", "group", "inside");
    expect(into).toEqual([
      { parentId: null, order: ["b", "group"] },
      { parentId: "group", order: ["child", "a"] },
    ]);

    expect(planMove(roots, "group", "child", "after")).toEqual([]);
  });

  it("drops a section into trash and will not move the trash folder", () => {
    const roots = tree();
    roots.push({
      kind: "group",
      header: { id: "trash", title: "Trash", synopsis: "", status: "idea", role: "body" },
      body: "",
      prefix: "",
      slug: "trash",
      dir: "",
      entryName: "trash",
      children: [],
    });
    const into = planMove(roots, "b", "trash", "before");
    expect(into).toEqual([
      { parentId: null, order: ["a", "group"] },
      { parentId: "trash", order: ["b"] },
    ]);
    expect(planMove(roots, "trash", "a", "before")).toEqual([]);
  });
});

describe("the book folder", () => {
  it("creates, reorders, and saves without renaming when the title changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "bookwriter-"));
    const fs = nodeFs();
    await fs.mkdir(join(root, "manuscript"));
    await fs.writeText(join(root, "book.yaml"), "title: Trial\n");

    let book = await loadBook(fs, root);
    const chapter = await createNode(fs, book, null, "group", "The Rule");
    book = await loadBook(fs, root);
    const inward = await createNode(fs, book, chapter, "section", "Inward");
    const edge = await createNode(fs, book, chapter, "section", "Boundaries");
    book = await loadBook(fs, root);

    const group = book.nodes[0];
    expect(group.kind).toBe("group");
    expect(group.header.id).toBe("the-rule");
    expect(group.header.unit).toBe("section");
    expect(group.children[0].header.unit).toBe("text");
    expect(group.children.map((child) => child.header.id)).toEqual(["inward", "boundaries"]);

    await moveNode(fs, book, edge, inward, "before");
    book = await loadBook(fs, root);
    expect(book.nodes[0].children.map((child) => child.entryName)).toEqual([
      "010-boundaries.md",
      "020-inward.md",
    ]);
    expect(book.nodes[0].children.map((child) => child.header.id)).toEqual(["boundaries", "inward"]);

    const moved = book.nodes[0].children[1];
    const originalPath = filePath(moved);
    await saveNode(
      fs,
      moved,
      { ...moved.header, title: "Points Inward", status: "revise" },
      "A dependency points inward.\n",
    );
    const saved = await readFile(originalPath, "utf8");
    expect(saved).toContain("id: inward\n");
    expect(saved).toContain("title: Points Inward\n");
    expect(saved).toContain("status: revise\n");
    expect(saved.endsWith("---\nA dependency points inward.\n")).toBe(true);
    expect(originalPath.endsWith("020-inward.md")).toBe(true);

    await deleteNode(fs, book, "boundaries");
    book = await loadBook(fs, root);
    expect(book.nodes[0].children.map((child) => child.header.id)).toEqual(["inward"]);
    const trashed = book.nodes.find((node) => node.header.id === "trash");
    expect(trashed?.children.map((child) => child.header.id)).toEqual(["boundaries"]);
    expect(exportBook(book.nodes).markdown).not.toContain("Boundaries");

    const below = await createNode(fs, book, chapter, "section", "After Inward");
    book = await loadBook(fs, root);
    await moveNode(fs, book, below, "inward", "after");
    book = await loadBook(fs, root);
    expect(book.nodes[0].children.map((child) => child.header.id)).toEqual(["inward", "after-inward"]);

    const opening = await createNode(fs, book, chapter, "section", "Opening");
    book = await loadBook(fs, root);
    const first = book.nodes[0].children[0];
    await moveNode(fs, book, opening, first.header.id, "before");
    book = await loadBook(fs, root);
    expect(book.nodes[0].children.map((child) => child.header.id)).toEqual(["opening", "inward", "after-inward"]);
  });
});
