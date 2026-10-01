import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeJpeg, makePng } from "./imageFixtures";
import { exportPdf, exportPdfWithPictures, expandTabs, loadPictures, markdownToPdf, pictureSources } from "./pdf";
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
  node("group", { id: "one", title: "Chapter One", unit: "chapter" }, "Opener with *emphasis* and `code`.\n", [
    node("section", { id: "inward", title: "Inward" }, "Text.[^1]\n\n- first\n- second\n\n```ts\nconst a = (1);\n```\n\n[^1]: A note.\n"),
  ]),
  node("section", { id: "trash", title: "Trash" }, "Never exported.\n"),
];

describe("pdf export", () => {
  it("writes a well-formed PDF document", () => {
    const result = exportPdf(book, "My Book");
    expect(result.pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(result.pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.pdf).toContain("/Count 2");
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

  it("draws a directory tree and a dash rule instead of question marks", () => {
    const result = markdownToPdf(
      ["```", "HTW/", "  ├── .gitignore", "  │   └── Cave.java", "  └ missing", "────────", "\u2571\u2572\u2573\u253c", "```", ""].join("\n"),
    );
    expect(result.pdf).toContain("HTW/");
    expect(result.pdf).toContain("|-- .gitignore");
    expect(result.pdf).toContain("|   `-- Cave.java");
    expect(result.pdf).toContain("` missing");
    expect(result.pdf).toContain("--------");
    expect(shown(result.pdf).some((piece) => piece.text.includes("/\\x+"))).toBe(true);
    expect(result.pdf).not.toContain("?");
    expect(result.warnings.some((warning) => warning.includes("cannot be shown"))).toBe(false);
  });

  it("draws pi, a raised six, and the transcript marks", () => {
    const prose = markdownToPdf("the digit of \u03c0 is in 10\u00b9\u2076.\n");
    expect(prose.pdf).toContain("/Symbol");
    expect(prose.pdf).toContain("/F6");
    expect(prose.pdf).toContain("(6)");
    expect(prose.pdf).toMatch(/Ts \(6\) Tj/);
    expect(prose.warnings.some((warning) => warning.includes("cannot be shown"))).toBe(false);

    const code = markdownToPdf(["```", "\u276f ask", "\u23fa answer", "  \u23bf  Done", "(1\u2212cov)", "```", ""].join("\n"));
    expect(code.pdf).toContain("\\233 ask");
    expect(code.pdf).toContain("\\225 answer");
    expect(code.pdf).toContain("`  Done");
    expect(code.pdf).toContain("1-cov");
    expect(code.pdf).not.toContain("?");
    expect(code.warnings.some((warning) => warning.includes("cannot be shown"))).toBe(false);
  });

  it("keeps a soft break, a forced break, and a horizontal rule", () => {
    const result = markdownToPdf("one\ntwo\n\nthree  \nfour\n\n---\n\nAfter.\n");
    const texts = shown(result.pdf).map((piece) => piece.text);
    expect(texts).toContain("one two");
    expect(texts).toContain("three");
    expect(texts).toContain("four");
    expect(texts).toContain("After.");
    expect(result.pdf).toMatch(/0\.6 G 0\.5 w [\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S/);
  });

  it("is plain ASCII so the text writer can save it", () => {
    const result = markdownToPdf("Caf\u00e9 \u2014 \u201cquoted\u201d \u4e2d\n");
    expect(/^[\x00-\x7f]*$/.test(result.pdf)).toBe(true);
    expect(result.pdf).toContain("\\351");
    expect(result.warnings.some((warning) => warning.includes("cannot be shown"))).toBe(true);
  });

  it("starts each folder on a new page and leaves a section where it falls", () => {
    const nested = node("group", { id: "nested", title: "Nested" }, "Inside the folder.\n");
    const kept = node("section", { id: "kept", title: "Kept" }, "Stays with the folder.\n");
    const folder = node("group", { id: "folder", title: "Folder" }, "Opener.\n", [kept, nested]);
    const another = node("group", { id: "another", title: "Another" }, "Next folder.\n");
    const opening = exportPdf([folder]);
    expect(opening.pages).toBe(2);
    expect(opening.pdf).not.toContain("page-break");
    expect(opening.pdf).not.toContain("chapter-number");
    const followed = exportPdf([
      node("section", { id: "loose", title: "Loose" }, "Before the folders.\n"),
      folder,
      another,
    ]);
    expect(followed.pages).toBe(4);
  });

  it("prints front matter notes before the body and chapter notes at the end of that chapter", () => {
    const intro = node("section", { id: "intro", title: "Introduction", unit: "text" }, "Intro body.[^1]\n\n[^1]: Intro note.\n");
    const preface = node(
      "group",
      { id: "preface", title: "Preface", role: "front" },
      "Preface body.[^1]\n\n[^1]: Front note.\n",
      [intro],
    );
    const later = node("section", { id: "later", title: "Later", unit: "text" }, "After the note.\n");
    const inside = node("section", { id: "inside", title: "Inside", unit: "text" }, "Inside text.[^2]\n\n[^2]: Inside note.\n");
    const first = node(
      "group",
      { id: "one", title: "First", unit: "chapter" },
      "First body.[^1]\n\n[^1]: First note.\n",
      [inside, later],
    );
    const second = node("section", { id: "two", title: "Second", unit: "chapter" }, "Second body.[^7]\n\n[^7]: Second note.\n");
    const part = node("group", { id: "part", title: "The Part", unit: "part" }, "Part opener.\n", [first, second]);
    const texts = shown(exportPdf([preface, part], "Book").pdf).map((piece) => piece.text);
    const at = (label: string) => {
      const index = texts.findIndex((piece) => piece.includes(label));
      expect(index, label).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(at("Front note.")).toBeGreaterThan(at("Intro body."));
    expect(at("Intro note.")).toBeGreaterThan(at("Front note."));
    expect(at("Part opener.")).toBeGreaterThan(at("Intro note."));
    expect(at("First body.")).toBeGreaterThan(at("Part opener."));
    expect(at("First note.")).toBeGreaterThan(at("After the note."));
    expect(at("Inside note.")).toBeGreaterThan(at("First note."));
    expect(at("Second body.")).toBeGreaterThan(at("Inside note."));
    expect(at("Second note.")).toBeGreaterThan(at("Second body."));
    expect(texts.filter((piece) => piece === "Notes")).toHaveLength(3);
    expect(texts.find((piece) => piece.includes("Preface body."))).toContain("[1]");
    expect(texts.find((piece) => piece.includes("Intro body."))).toContain("[2]");
    expect(texts.find((piece) => piece.includes("First body."))).toContain("[1]");
    expect(texts.find((piece) => piece.includes("Inside text."))).toContain("[2]");
    expect(texts.find((piece) => piece.includes("Second body."))).toContain("[1]");
  });

  it("prints a footnote that sits in a heading", () => {
    const chapter = node(
      "section",
      { id: "plane", title: "Plane", unit: "chapter" },
      "## SOLID[^2] Design Principles\n\n[^2]: Martin, 2003.\n",
    );
    const { pdf } = exportPdf([chapter], "Book");
    const text = shown(pdf).map((piece) => piece.text).join("");
    expect(text).toContain("SOLID[1] Design Principles");
    expect(text).toContain("Martin, 2003.");
    expect(text).not.toContain("[^");
  });

  it("keeps a chapter with its title when the previous page is nearly full", () => {
    const filler = "Hello.\n\n".repeat(24);
    const chapter = markdownToPdf(
      `${filler}<p class="chapter-number">Chapter 1</p>\n\n# The Title\n\nThe chapter body.\n`,
    );
    const chapterPage = pageOf(chapter.pdf, "Chapter 1");
    expect(chapterPage).toBe(pageOf(chapter.pdf, "The Title"));
    expect(chapterPage).toBe(pageOf(chapter.pdf, "The chapter body."));
    expect(firstText(chapter.pdf, chapterPage)).toBe("Chapter 1");

    const heading = markdownToPdf(`${filler}## The Future\n\n### Where next\n\nIt continues.\n`);
    const headingPage = pageOf(heading.pdf, "The Future");
    expect(headingPage).toBe(pageOf(heading.pdf, "Where next"));
    expect(headingPage).toBe(pageOf(heading.pdf, "It continues."));
    expect(firstText(heading.pdf, headingPage)).toBe("The Future");

    const part = markdownToPdf(
      `${filler}<p class="chapter-number">Part 1</p>\n\n# The Part\n\nThe part body.\n`,
    );
    const partPage = pageOf(part.pdf, "Part 1");
    expect(partPage).toBe(pageOf(part.pdf, "The Part"));
    expect(partPage).toBe(pageOf(part.pdf, "The part body."));
    expect(firstText(part.pdf, partPage)).toBe("Part 1");
  });

  it("starts a new page where the page break is set", () => {
    const scene = node("section", { id: "scene", title: "Scene", break: true }, "On its own page.\n");
    const folder = node("group", { id: "folder", title: "Folder", break: false }, "Same page.\n", [scene]);
    const followed = exportPdf([node("section", { id: "loose", title: "Loose" }, "Before.\n"), folder]);
    expect(followed.pages).toBe(2);
    const opening = exportPdf([node("section", { id: "scene", title: "Scene", break: true }, "Opens the book.\n")]);
    expect(opening.pages).toBe(1);
  });

  it("contains the book text and the notes but not the trash", () => {
    const { pdf } = exportPdf(book);
    for (const text of ["Preface", "Chapter 1", "Chapter One", "Inward", "The preface body.", "const a = \\(1\\);", "A note.", "first"]) {
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

function unescapePdf(text: string): string {
  return text.replace(/\\([0-7]{3}|.)/g, (_, code: string) => (code.length === 3 ? String.fromCharCode(parseInt(code, 8)) : code));
}

/** Page number (from 1) of the first text run equal to `text`, ignoring the footer. */
function pageOf(pdf: string, text: string): number {
  const pages = [...pdf.matchAll(/stream\n([\s\S]*?)endstream/g)].map((match) => match[1]);
  for (let i = 0; i < pages.length; i++) {
    if (pageTexts(pages[i]).includes(text)) return i + 1;
  }
  return 0;
}

function firstText(pdf: string, page: number): string {
  const pages = [...pdf.matchAll(/stream\n([\s\S]*?)endstream/g)].map((match) => match[1]);
  return pageTexts(pages[page - 1] ?? "").find((text) => !/^\d+$/.test(text)) ?? "";
}

function pageTexts(stream: string): string[] {
  const out: string[] = [];
  for (const part of stream.matchAll(/([\d.]+) ([\d.]+) Td([\s\S]*?) ET/g)) {
    if (Number(part[2]) < 50) continue;
    const strings = [...part[3].matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => unescapePdf(match[1]));
    const text = strings.join("");
    if (text) out.push(text);
  }
  return out;
}

/** The text-showing operators of the first page, as [font, size, string] in order. */
function shown(pdf: string): { font: string; text: string }[] {
  const out: { font: string; text: string }[] = [];
  for (const block of pdf.matchAll(/BT ([^\n]*?) ET/g)) {
    for (const part of block[1].matchAll(/\/(F\d) [\d.]+ Tf \(((?:\\.|[^\\)])*)\) Tj/g)) {
      out.push({ font: part[1], text: unescapePdf(part[2]) });
    }
  }
  return out;
}

function withBook<T>(files: Record<string, Buffer | string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "bookwriter-pdfpic-"));
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), data);
  }
  return run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

const rgbPng = makePng({ width: 2, height: 2, colorType: 2, rows: [[255, 0, 0, 0, 255, 0], [0, 0, 255, 9, 9, 9]] });
const alphaPng = makePng({ width: 2, height: 1, colorType: 6, rows: [[1, 2, 3, 255, 4, 5, 6, 100]] });

describe("pdf code", () => {
  it("sets inline code in Courier and the rest in Helvetica on the same line", () => {
    const { pdf } = markdownToPdf("Call `foo(bar)` now and **bold** and *soft*.\n");
    const line = shown(pdf).filter((piece) => piece.text.includes("Call") || piece.font === "F3" || piece.text.includes("now"));
    expect(line.map((piece) => piece.font)).toEqual(["F1", "F3", "F1"]);
    expect(line[1].text).toBe("foo(bar)");
    const fonts = shown(pdf).map((piece) => piece.font);
    expect(fonts).toContain("F2");
    expect(fonts).toContain("F4");
    // All on one text object, so it is one line on the page.
    expect(pdf).toMatch(/\(Call \) Tj \/F3 [\d.]+ Tf \(foo\\\(bar\\\)\) Tj/);
  });

  it("does not break a short code span across lines", () => {
    const text = "word ".repeat(13) + "`abc def` tail\n";
    const { pdf } = markdownToPdf(text);
    const code = shown(pdf).filter((piece) => piece.font === "F3");
    expect(code.map((piece) => piece.text)).toEqual(["abc def"]);
  });

  it("keeps code spans in Courier inside headings, lists, quotes and tables", () => {
    const { pdf } = markdownToPdf("# Title `x`\n\n- item `y`\n\n> quote `z`\n\n| a | b |\n| - | - |\n| `c` | d |\n");
    const code = shown(pdf).filter((piece) => piece.font === "F3").map((piece) => piece.text);
    expect(code).toEqual(["x", "y", "z", "c"]);
  });

  it("lays out a fenced block line by line with indentation, in Courier, on a shaded box", () => {
    const { pdf } = markdownToPdf("```clojure\n(defn f [x]\n  (inc x))\n\n\t(tabbed)\n```\n");
    const code = shown(pdf).filter((piece) => piece.font === "F3").map((piece) => piece.text);
    expect(code).toEqual(["(defn f [x]", "  (inc x))", "    (tabbed)"]);
    expect(pdf).toMatch(/0\.95 g [\d.]+ [\d.]+ 468\.00 [\d.]+ re f/);
    // The three lines sit at descending baselines and the blank line takes a row of its own.
    const ys = [...pdf.matchAll(/BT 0 g ([\d.]+) ([\d.]+) Td \/F3/g)].map((m) => Number(m[2]));
    expect(ys[0] - ys[1]).toBeCloseTo(11.5);
    expect(ys[1] - ys[2]).toBeCloseTo(23);
    // Indentation is real spaces, so it is the same x for every line.
    const xs = new Set([...pdf.matchAll(/BT 0 g ([\d.]+) ([\d.]+) Td \/F3/g)].map((m) => m[1]));
    expect(xs.size).toBe(1);
  });

  it("expands tabs to the next four-column stop", () => {
    expect(expandTabs("\tx")).toBe("    x");
    expect(expandTabs("ab\tx")).toBe("ab  x");
    expect(expandTabs("abcd\tx")).toBe("abcd    x");
  });

  it("escapes parentheses and backslashes in code", () => {
    const { pdf } = markdownToPdf("```\nprintf(\"%s\\n\", (a));\n```\n\nInline `a\\b (c)` here.\n");
    expect(pdf).toContain("(printf\\(\"%s\\\\n\", \\(a\\)\\);) Tj");
    expect(pdf).toContain("(a\\\\b \\(c\\)) Tj");
  });

  it("cuts an over-long code line at the box edge and marks the continuation", () => {
    const { pdf } = markdownToPdf("```\n" + "0123456789".repeat(20) + "\n```\n");
    const rows = shown(pdf).filter((piece) => piece.font === "F3" && piece.text !== "\u00bb" && piece.text !== "\xbb");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.text).join("")).toBe("0123456789".repeat(20));
    for (const row of rows) expect(row.text.length * 0.6 * 9).toBeLessThanOrEqual(468);
    expect(pdf).toContain("0.45 g");
  });

  it("splits a tall code block between pages without losing a line", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
    const result = markdownToPdf("Intro.\n\n```\n" + lines.join("\n") + "\n```\n\nAfter.\n");
    expect(result.pages).toBeGreaterThan(2);
    const code = shown(result.pdf).filter((piece) => piece.font === "F3").map((piece) => piece.text);
    expect(code).toEqual(lines);
  });

  it("indents an indented code block and a fence inside a list", () => {
    const { pdf } = markdownToPdf("- item\n\n  ```\n  code\n  ```\n");
    const box = /0\.95 g ([\d.]+) /.exec(pdf);
    expect(Number(box![1])).toBeGreaterThan(72);
  });
});

describe("pdf pictures", () => {
  it("finds the pictures a text refers to", () => {
    expect(pictureSources("![a](images/a.png)\n\ntext ![b](b.jpg){width=10%} and ![a](images/a.png)\n")).toEqual(["images/a.png", "b.jpg"]);
  });

  it("embeds a JPEG untouched and a PNG as Flate, scaled to fit the page width", async () => {
    await withBook({ "images/photo.jpg": makeJpeg(1200, 600), "images/dot.png": rgbPng }, async (root) => {
      const md = "![Big photo](images/photo.jpg)\n\n![Dot](images/dot.png)\n";
      const pictures = await loadPictures(nodeFs(), root, md);
      const { pdf, warnings } = markdownToPdf(md, "T", pictures);
      expect(warnings).toEqual([]);
      expect(pdf).toContain("/Subtype /Image /Width 1200 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCII85Decode /DCTDecode]");
      expect(pdf).toContain("/Filter [/ASCII85Decode /FlateDecode] /DecodeParms [null << /Predictor 15 /Colors 3");
      expect(/^[\x00-\x7f]*$/.test(pdf)).toBe(true);
      // The wide photo is scaled to the 468 pt text width and keeps its 2:1 shape.
      expect(pdf).toMatch(/q 468 0 0 234 72 [\d.]+ cm \/Im0 Do Q/);
      // The 2x2 dot is shown at its natural 96 dpi size (1.5 pt per pixel), centred.
      expect(pdf).toMatch(/q 1\.5 0 0 1\.5 [\d.]+ [\d.]+ cm \/Im1 Do Q/);
      expect(pdf).toContain("/XObject << /Im0");
      // Caption text is the alt text, in italics, and the [alt] placeholder is not used.
      expect(shown(pdf)).toContainEqual({ font: "F4", text: "Big photo" });
      expect(pdf).not.toContain("[Big photo]");
    });
  });

  it("gives a picture with transparency a soft mask", async () => {
    await withBook({ "a.png": alphaPng }, async (root) => {
      const md = "![Glass](a.png)\n";
      const { pdf } = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      const mask = /\/SMask (\d+) 0 R/.exec(pdf);
      expect(mask).not.toBeNull();
      expect(pdf).toContain(`${mask![1]} 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceGray`);
    });
  });

  it("honours a {width=} block and does not print it", async () => {
    await withBook({ "a.png": rgbPng }, async (root) => {
      const md = "![Half](a.png){width=50%}\n";
      const { pdf } = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      expect(pdf).toMatch(/q 234 0 0 234 /);
      expect(pdf).not.toContain("width=");
      const inches = await (async () => {
        const text = "![In](a.png){width=2in}\n";
        return markdownToPdf(text, "", await loadPictures(nodeFs(), root, text)).pdf;
      })();
      expect(inches).toMatch(/q 144 0 0 144 /);
    });
  });

  it("shrinks a tall picture to fit the page height and keeps it whole on one page", async () => {
    await withBook({ "tall.jpg": makeJpeg(100, 2000) }, async (root) => {
      const md = "Text before.\n\n![Tall](tall.jpg)\n\nText after.\n";
      const result = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      const match = /q ([\d.]+) 0 0 ([\d.]+) [\d.]+ ([\d.]+) cm \/Im0 Do Q/.exec(result.pdf)!;
      const [w, h, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      expect(h).toBeLessThan(648);
      expect(w / h).toBeCloseTo(100 / 2000, 2);
      expect(y).toBeGreaterThanOrEqual(72);
      expect(y + h).toBeLessThanOrEqual(720 + 0.01);
    });
  });

  it("moves a picture that does not fit the rest of the page to the next one", async () => {
    await withBook({ "p.jpg": makeJpeg(600, 400) }, async (root) => {
      const filler = ("word ".repeat(120) + "\n\n").repeat(3);
      const md = filler + "![Fits not](p.jpg)\n";
      const result = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      const pages = result.pdf.split("/Type /Page /Parent");
      const pageWithImage = pages.findIndex((page) => page.includes("/Im0 Do"));
      expect(pageWithImage).toBeGreaterThan(0);
      expect(result.pages).toBe(2);
      expect(pages[pageWithImage]).toContain("/XObject");
    });
  });

  it("uses one picture object for a picture shown twice", async () => {
    await withBook({ "a.png": rgbPng }, async (root) => {
      const md = "![One](a.png)\n\n![Two](a.png)\n";
      const { pdf } = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      expect((pdf.match(/\/Subtype \/Image/g) ?? []).length).toBe(1);
      expect((pdf.match(/\/Im0 Do/g) ?? []).length).toBe(2);
    });
  });

  it("warns and shows [alt] for a missing, unsupported or outside picture, without failing", async () => {
    await withBook({ "bad.png": Buffer.from("not a picture at all"), "old.gif": Buffer.from("GIF89a......") }, async (root) => {
      const md = "![Gone](missing.png)\n\n![Bad](bad.png)\n\n![Old](old.gif)\n\n![Out](../secret.png)\n\n![Web](https://example.com/a.png)\n";
      const { pdf, warnings, pages } = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      expect(pages).toBe(1);
      expect(warnings).toHaveLength(5);
      expect(warnings[0]).toContain('"missing.png" is not in the PDF: the file could not be read');
      expect(warnings[1]).toContain("only JPEG and PNG");
      expect(warnings[3]).toContain("outside the book folder");
      for (const alt of ["Gone", "Bad", "Old", "Out", "Web"]) expect(shown(pdf)).toContainEqual({ font: "F4", text: `[${alt}]` });
      expect(pdf).not.toContain("/Subtype /Image");
    });
  });

  it("keeps the [alt] text when no pictures were loaded", () => {
    const result = markdownToPdf("![Alt words](a.png)\n");
    expect(shown(result.pdf)).toContainEqual({ font: "F4", text: "[Alt words]" });
    expect(result.warnings).toHaveLength(1);
  });

  it("puts a picture inside a sentence on its own line without losing the text", async () => {
    await withBook({ "a.png": rgbPng }, async (root) => {
      const md = "Before ![Dot](a.png) after.\n";
      const { pdf } = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      const words = shown(pdf).map((piece) => piece.text).join("|");
      expect(words).toContain("Before");
      expect(words).toContain("after.");
      expect(pdf).toContain("/Im0 Do");
      expect(words).not.toContain("Dot");
    });
  });

  it("applies EXIF orientation to a rotated photo", async () => {
    await withBook({ "r.jpg": makeJpeg(300, 200, 3, 6) }, async (root) => {
      const md = "![Turned](r.jpg)\n";
      const { pdf } = markdownToPdf(md, "", await loadPictures(nodeFs(), root, md));
      // Orientation 6 shows the 300x200 data as a 200x300 portrait picture (225 x 150 pt natural, so 150 wide, 225 tall).
      expect(pdf).toMatch(/q 0 -225 150 0 [\d.]+ [\d.]+ cm \/Im0 Do Q/);
    });
  });

  it("builds a whole book with pictures and writes a readable file", async () => {
    await withBook({ "images/a.png": rgbPng, "images/b.jpg": makeJpeg(50, 50) }, async (root) => {
      const nodes = [
        node("section", { id: "s", title: "Pics" }, "Look: ![Dot](images/a.png)\n\n![Nope](images/none.png)\n\n![Cam](<images/b.jpg>)\n\n```\ncode (x)\n```\n"),
      ];
      const result = await exportPdfWithPictures(nodes, "Pic Book", nodeFs(), root);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("images/none.png");
      const destination = join(root, "out", "book.pdf");
      await nodeFs().writeText(destination, result.pdf);
      const bytes = readFileSync(destination);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      // The file is byte-for-byte what was built, so the offsets in the xref are still right.
      expect(bytes.toString("latin1")).toBe(result.pdf);
      const startxref = Number(/startxref\n(\d+)\n/.exec(result.pdf)![1]);
      expect(bytes.subarray(startxref, startxref + 4).toString("latin1")).toBe("xref");
      const entries = [...result.pdf.matchAll(/^(\d{10}) 00000 n $/gm)];
      entries.forEach((entry, index) => {
        const at = Number(entry[1]);
        expect(result.pdf.slice(at, at + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
      });
      // Declared stream lengths are exact.
      const streams = [...result.pdf.matchAll(/\/Length (\d+)[^>]*>>\nstream\n([\s\S]*?)endstream/g)];
      expect(streams.length).toBeGreaterThan(2);
      for (const stream of streams) {
        // A picture's data is followed by a line end that is not part of the length; page content ends in its own.
        expect([stream[2].length, stream[2].length - 1]).toContain(Number(stream[1]));
        expect(stream[2].endsWith("\n")).toBe(true);
      }
    });
  });
});

