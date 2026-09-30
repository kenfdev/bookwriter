import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPdf, markdownToPdf } from "./pdf";
import { nodeFs } from "./nodeFs";
import type { TreeNode } from "./model";

function node(
  kind: TreeNode["kind"],
  header: Partial<TreeNode["header"]> & { id: string; title: string },
  body: string,
  children: TreeNode[] = [],
): TreeNode {
  return {
    kind,
    header: { synopsis: "", status: "draft", role: "body", ...header },
    body,
    prefix: "010",
    slug: header.id,
    dir: "",
    entryName: "",
    children,
  };
}

const book = [
  node("section", { id: "preface", title: "Preface", role: "front" }, "The preface body.\n"),
  node("group", { id: "one", title: "Chapter One" }, "Opener with *emphasis* and `code`.\n", [
    node("section", { id: "inward", title: "Inward" }, "Text.[^1]\n\n- first\n- second\n\n```ts\nconst a = (1);\n```\n\n[^1]: A note.\n"),
  ]),
  node("section", { id: "trash", title: "Trash" }, "Never exported.\n"),
];

describe("pdf export", () => {
  it("writes a well-formed PDF document", () => {
    const result = exportPdf(book, "My Book");
    expect(result.pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(result.pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(result.pages).toBe(1);
    expect(result.pdf).toContain("/Count 1");
    expect(result.pdf).toContain("(My Book)");
    const startxref = Number(/startxref\n(\d+)\n/.exec(result.pdf)![1]);
    expect(result.pdf.slice(startxref, startxref + 4)).toBe("xref");
    // Every xref offset points at its object.
    const entries = [...result.pdf.matchAll(/^(\d{10}) 00000 n $/gm)];
    entries.forEach((entry, index) => {
      const at = Number(entry[1]);
      expect(result.pdf.slice(at, at + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it("is plain ASCII so the text writer can save it", () => {
    const result = markdownToPdf("Caf\u00e9 \u2014 \u201cquoted\u201d \u4e2d\n");
    expect(/^[\x00-\x7f]*$/.test(result.pdf)).toBe(true);
    expect(result.pdf).toContain("\\351");
    expect(result.warnings.some((warning) => warning.includes("cannot be shown"))).toBe(true);
  });

  it("contains the book text and the notes but not the trash", () => {
    const { pdf } = exportPdf(book);
    for (const text of ["Preface", "Chapter One", "Inward", "The preface body.", "const a = \\(1\\);", "A note.", "first"]) {
      expect(pdf).toContain(text);
    }
    expect(pdf).not.toContain("Never exported");
  });

  it("escapes parentheses and backslashes in page text", () => {
    const { pdf } = markdownToPdf("a (b) c\\\\d\n");
    expect(pdf).toContain("(a \\(b\\) c");
  });

  it("flows a long book onto many pages and numbers them", () => {
    const paragraph = "word ".repeat(200) + "\n\n";
    const big = markdownToPdf(paragraph.repeat(40), "Long");
    expect(big.pages).toBeGreaterThan(5);
    expect(big.pdf).toContain(`/Count ${big.pages}`);
    expect(big.pdf).toContain(`(${big.pages}) Tj`);
  });

  it("breaks a word longer than the line", () => {
    const result = markdownToPdf("x".repeat(400) + "\n");
    expect(result.pages).toBe(1);
    expect((result.pdf.match(/\(x+\) Tj/g) ?? []).length).toBeGreaterThan(1);
  });

  it("carries export warnings through", () => {
    const deep = node("section", { id: "deep", title: "Deep" }, "###### Too deep\n");
    const result = exportPdf([deep]);
    expect(result.warnings.some((warning) => warning.includes("level 7"))).toBe(true);
  });

  it("saves through the same file writer as the Markdown export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bookwriter-pdf-"));
    try {
      const destination = join(dir, "out", "book.pdf");
      await nodeFs().writeText(destination, exportPdf(book, "My Book").pdf);
      const bytes = readFileSync(destination);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(statSync(destination).size).toBeGreaterThan(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
