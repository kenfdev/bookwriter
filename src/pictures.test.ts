import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFs } from "./nodeFs";
import { placePicture, relativeToBook, resolvePictureSources } from "./pictures";
import { renderSection } from "./preview";
import type { TreeNode } from "./model";

function section(body: string): TreeNode {
  return {
    kind: "section",
    header: { id: "inward", title: "Inward", synopsis: "", status: "draft", role: "body" },
    body,
    prefix: "010",
    slug: "inward",
    dir: "",
    entryName: "010-inward.md",
    children: [],
  };
}

async function gone(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

describe("pictures", () => {
  it("moves a file into the book and records a path from the book folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "bookwriter-book-"));
    const outside = await mkdtemp(join(tmpdir(), "bookwriter-pic-"));
    const source = join(outside, "bridge.jpg");
    await writeFile(source, Buffer.from([0xff, 0xd8, 0x01]));
    const fs = nodeFs();

    const relative = await placePicture(fs, root, source);

    expect(relative).toBe("images/bridge.jpg");
    expect(relative.startsWith("/")).toBe(false);
    expect(relative.includes(outside)).toBe(false);
    expect(await gone(source)).toBe(true);
    expect(await readFile(join(root, relative))).toEqual(Buffer.from([0xff, 0xd8, 0x01]));
  });

  it("keeps a file already in images and suffixes a name that is taken", async () => {
    const root = await mkdtemp(join(tmpdir(), "bookwriter-book-"));
    const fs = nodeFs();
    await fs.mkdir(join(root, "images"));
    await writeFile(join(root, "images", "kept.jpg"), "kept");
    await writeFile(join(root, "images", "bridge.jpg"), "first");

    const kept = await placePicture(fs, root, join(root, "images", "kept.jpg"));
    expect(kept).toBe("images/kept.jpg");
    expect(await readFile(join(root, "images", "kept.jpg"), "utf8")).toBe("kept");
    expect(await gone(join(root, "images", "kept-2.jpg"))).toBe(true);

    const outside = await mkdtemp(join(tmpdir(), "bookwriter-pic-"));
    const source = join(outside, "bridge.jpg");
    await writeFile(source, "second");
    const relative = await placePicture(fs, root, source);
    expect(relative).toBe("images/bridge-2.jpg");
    expect(await readFile(join(root, "images", "bridge.jpg"), "utf8")).toBe("first");
    expect(await readFile(join(root, relative), "utf8")).toBe("second");
  });

  it("refuses a file that is not a picture", async () => {
    const root = await mkdtemp(join(tmpdir(), "bookwriter-book-"));
    const outside = await mkdtemp(join(tmpdir(), "bookwriter-pic-"));
    const source = join(outside, "chapter.md");
    await writeFile(source, "prose");
    await expect(placePicture(nodeFs(), root, source)).rejects.toThrow("Choose a picture file.");
    expect(await readFile(source, "utf8")).toBe("prose");
  });

  it("counts a picture path from the book, including one written with a leading slash", () => {
    expect(relativeToBook("/books/novel", "/books/novel/images/bridge.jpg")).toBe("images/bridge.jpg");
    expect(relativeToBook("/books/novel", "/tmp/bridge.jpg")).toBeNull();
    expect(relativeToBook("/", "/images/bridge.jpg")).toBe("images/bridge.jpg");
    expect(relativeToBook("/", "images/bridge.jpg")).toBeNull();
    expect(relativeToBook("/", "/")).toBeNull();

    const html = renderSection(section("![Bridge](images/bridge.jpg)\n"), []).html;
    const shown = resolvePictureSources(html, (relative) => `book:///${relative}`);
    expect(shown).toContain('src="book:///images/bridge.jpg"');

    const rooted = resolvePictureSources(`<img src="/images/bridge.jpg" alt="Bridge">`, (relative) => `book:///${relative}`);
    expect(rooted).toContain('src="book:///images/bridge.jpg"');

    const remote = resolvePictureSources(`<img src="https://example.com/a.jpg" alt="A">`, () => "NO");
    expect(remote).toContain('src="https://example.com/a.jpg"');

    const escaped = resolvePictureSources(`<img src="../secret.jpg" alt="x">`, () => "NO");
    expect(escaped).not.toContain("NO");
    expect(escaped).not.toContain("src=");

    const coded = renderSection(section("A mark is `![x](images/a.jpg)`.\n"), []).html;
    expect(resolvePictureSources(coded, () => "NO")).not.toContain("NO");
  });
});
