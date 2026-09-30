import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { exportBook } from "./export";
import type { TreeNode } from "./model";

/**
 * PDF export. The book is exported to manuscript Markdown exactly as the Markdown
 * export does, parsed with the same Markdown dialect the preview uses, then laid
 * out on US Letter pages with the PDF standard fonts. The result is plain ASCII,
 * so it can be saved through the same text writer as every other export.
 */

export type PdfResult = { pdf: string; pages: number; warnings: string[] };

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FOOTER_Y = 40;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = MARGIN;

type FontKey = "F1" | "F2" | "F3";

// Helvetica advance widths for ASCII 32..126, in 1/1000 em.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x2026: 0x85,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2122: 0x99,
};

/** Map text to single-byte WinAnsi codes; anything outside that set becomes "?". */
function encode(text: string): number[] {
  const codes: number[] = [];
  for (const char of text.normalize("NFC")) {
    const cp = char.codePointAt(0)!;
    if (cp === 9) codes.push(32, 32, 32, 32);
    else if (cp >= 32 && cp <= 126) codes.push(cp);
    else if (cp >= 160 && cp <= 255) codes.push(cp);
    else if (WIN_ANSI[cp] !== undefined) codes.push(WIN_ANSI[cp]);
    else codes.push(63);
  }
  return codes;
}

function pdfString(codes: number[]): string {
  let out = "(";
  for (const code of codes) {
    if (code === 40 || code === 41 || code === 92) out += "\\" + String.fromCharCode(code);
    else if (code < 32 || code > 126) out += "\\" + code.toString(8).padStart(3, "0");
    else out += String.fromCharCode(code);
  }
  return out + ")";
}

function glyphWidth(code: number, font: FontKey): number {
  if (font === "F3") return 600;
  const base = code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
  return font === "F2" ? base * 1.08 : base;
}

function textWidth(codes: number[], font: FontKey, size: number): number {
  let sum = 0;
  for (const code of codes) sum += glyphWidth(code, font);
  return (sum * size) / 1000;
}

type Line = { codes: number[]; font: FontKey; size: number; x: number; y: number };

/** Break one run of text into lines no wider than `width`. Over-long words are split. */
function wrap(text: string, font: FontKey, size: number, width: number, keepSpaces: boolean): number[][] {
  const lines: number[][] = [];
  for (const hard of text.split("\n")) {
    const codes = encode(hard);
    if (keepSpaces) {
      let current: number[] = [];
      for (const code of codes) {
        if (textWidth([...current, code], font, size) > width && current.length > 0) {
          lines.push(current);
          current = [];
        }
        current.push(code);
      }
      lines.push(current);
      continue;
    }
    let current: number[] = [];
    for (const word of splitWords(codes)) {
      const candidate = current.length ? [...current, 32, ...word] : word;
      if (textWidth(candidate, font, size) <= width) {
        current = candidate;
        continue;
      }
      if (current.length) lines.push(current);
      current = [];
      let rest = word;
      while (textWidth(rest, font, size) > width) {
        let cut = 1;
        while (cut < rest.length && textWidth(rest.slice(0, cut + 1), font, size) <= width) cut++;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

function splitWords(codes: number[]): number[][] {
  const words: number[][] = [];
  let current: number[] = [];
  for (const code of codes) {
    if (code === 32) {
      if (current.length) words.push(current);
      current = [];
    } else {
      current.push(code);
    }
  }
  if (current.length) words.push(current);
  return words;
}

class Layout {
  pages: Line[][] = [[]];
  y = PAGE_HEIGHT - MARGIN;

  newPage(): void {
    this.pages.push([]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Start a new page unless `height` still fits on this one. */
  need(height: number): void {
    if (this.y - height < BOTTOM && this.pages[this.pages.length - 1].length > 0) this.newPage();
  }

  text(
    text: string,
    options: { font: FontKey; size: number; indent?: number; leading?: number; after?: number; before?: number; keep?: boolean; bullet?: string; keepWithNext?: number },
  ): void {
    const indent = options.indent ?? 0;
    const leading = options.leading ?? options.size * 1.35;
    const lines = wrap(text, options.font, options.size, TEXT_WIDTH - indent, options.keep ?? false);
    if (options.before && this.pages[this.pages.length - 1].length > 0) this.y -= options.before;
    this.need(leading * Math.min(lines.length, 2) + (options.keepWithNext ?? 0));
    lines.forEach((codes, index) => {
      if (this.y - leading < BOTTOM) this.newPage();
      this.y -= leading;
      const page = this.pages[this.pages.length - 1];
      if (index === 0 && options.bullet) {
        page.push({ codes: encode(options.bullet), font: options.font, size: options.size, x: MARGIN + indent - 14, y: this.y });
      }
      page.push({ codes, font: options.font, size: options.size, x: MARGIN + indent, y: this.y });
    });
    this.y -= options.after ?? 0;
  }

  rule(): void {
    this.need(12);
    this.y -= 6;
    this.pages[this.pages.length - 1].push({ codes: [], font: "F1", size: 0, x: -1, y: this.y });
    this.y -= 6;
  }
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.use(footnote);

type Token = ReturnType<typeof md.parse>[number];

const HEADING_SIZE = [0, 24, 19, 16, 14, 12, 11];

function inlineText(token: Token): string {
  let out = "";
  for (const child of token.children ?? []) {
    switch (child.type) {
      case "text":
      case "code_inline":
        out += child.content;
        break;
      case "softbreak":
        out += " ";
        break;
      case "hardbreak":
        out += "\n";
        break;
      case "footnote_ref":
        out += `[${Number((child.meta as { id?: number } | null)?.id ?? 0) + 1}]`;
        break;
      case "image":
        out += `[${child.content || "image"}]`;
        break;
      default:
        break;
    }
  }
  return out;
}

function layoutTokens(tokens: Token[], layout: Layout, warnings: string[]): void {
  type ListState = { ordered: boolean; count: number };
  const lists: ListState[] = [];
  let quote = 0;
  let pendingBullet: string | null = null;
  let heading = 0;
  let inNotes = false;
  let noteNumber = 0;
  let row: string[] | null = null;
  let headerRow = false;
  let noteFirst = false;

  const indent = () => lists.length * 22 + quote * 18 + (inNotes ? 14 : 0);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case "heading_open":
        heading = Number(token.tag.slice(1));
        break;
      case "heading_close":
        heading = 0;
        break;
      case "bullet_list_open":
        lists.push({ ordered: false, count: 0 });
        break;
      case "ordered_list_open":
        lists.push({ ordered: true, count: Number(token.attrGet("start") ?? 1) - 1 });
        break;
      case "bullet_list_close":
      case "ordered_list_close":
        lists.pop();
        if (lists.length === 0) layout.y -= 4;
        break;
      case "list_item_open": {
        const state = lists[lists.length - 1];
        state.count += 1;
        pendingBullet = state.ordered ? `${state.count}.` : "\u2022";
        break;
      }
      case "blockquote_open":
        quote += 1;
        break;
      case "blockquote_close":
        quote -= 1;
        break;
      case "footnote_block_open":
        inNotes = true;
        layout.rule();
        layout.text("Notes", { font: "F2", size: 14, after: 6, keepWithNext: 30 });
        break;
      case "footnote_block_close":
        inNotes = false;
        break;
      case "footnote_open":
        noteNumber = Number((token.meta as { id?: number } | null)?.id ?? noteNumber - 1) + 1;
        noteFirst = true;
        break;
      case "tr_open":
        row = [];
        break;
      case "th_open":
        headerRow = true;
        break;
      case "tr_close":
        if (row) layout.text(row.join("  |  "), { font: headerRow ? "F2" : "F1", size: 10, indent: indent(), after: 2 });
        row = null;
        headerRow = false;
        break;
      case "hr":
        layout.rule();
        break;
      case "fence":
      case "code_block": {
        const body = token.content.replace(/\n$/, "");
        layout.text(body, { font: "F3", size: 9, indent: indent() + 8, leading: 11.5, after: 8, before: 2, keep: true });
        break;
      }
      case "inline": {
        const text = inlineText(token);
        if (row) {
          row.push(text);
        } else if (heading) {
          const clean = text.replace(/\s*\{-\}\s*$/, "");
          const size = HEADING_SIZE[heading];
          layout.text(clean, { font: "F2", size, before: heading <= 2 ? 18 : 12, after: 6, keepWithNext: 40 });
        } else if (inNotes) {
          const label = noteFirst ? `${noteNumber}.` : undefined;
          noteFirst = false;
          layout.text(text, { font: "F1", size: 9.5, indent: indent(), after: 3, bullet: label });
        } else {
          const bullet = pendingBullet ?? undefined;
          pendingBullet = null;
          layout.text(text, { font: "F1", size: 11, indent: indent(), leading: 15, after: lists.length ? 3 : 8, bullet });
        }
        break;
      }
      default:
        break;
    }
  }
  if (tokens.some((token) => token.type === "html_block")) warnings.push("Raw HTML is not shown in the PDF.");
}

function assemble(layout: Layout, title: string): string {
  const pageCount = layout.pages.length;
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const firstPage = 7;
  const kids = layout.pages.map((_, index) => `${firstPage + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
  objects[6] = `<< /Title ${pdfString(encode(title))} /Producer (Bookwriter) >>`;

  layout.pages.forEach((lines, index) => {
    let content = "";
    for (const line of lines) {
      if (line.x === -1) {
        content += `0.6 G 0.5 w ${MARGIN} ${line.y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${line.y.toFixed(2)} l S\n`;
        continue;
      }
      if (line.codes.length === 0) continue;
      content += `BT /${line.font} ${line.size} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td ${pdfString(line.codes)} Tj ET\n`;
    }
    const label = pdfString(encode(String(index + 1)));
    const width = textWidth(encode(String(index + 1)), "F1", 9);
    content += `BT /F1 9 Tf ${((PAGE_WIDTH - width) / 2).toFixed(2)} ${FOOTER_Y} Td ${label} Tj ET\n`;
    const pageId = firstPage + index * 2;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/** Render Markdown to a PDF document held as an ASCII string. */
export function markdownToPdf(markdown: string, title = ""): PdfResult {
  const warnings: string[] = [];
  const layout = new Layout();
  layoutTokens(md.parse(markdown, {}), layout, warnings);
  if (/[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2122]/u.test(markdown)) {
    warnings.push("Some characters cannot be shown in the PDF and were replaced with ?.");
  }
  return { pdf: assemble(layout, title), pages: layout.pages.length, warnings };
}

/** The whole book as a PDF: the same manuscript the Markdown export writes. */
export function exportPdf(nodes: TreeNode[], title = ""): PdfResult {
  const exported = exportBook(nodes);
  const rendered = markdownToPdf(exported.markdown, title);
  return { ...rendered, warnings: [...exported.warnings, ...rendered.warnings] };
}
