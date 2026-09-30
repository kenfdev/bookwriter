import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import type { Fs } from "./book";
import { CHAPTER_NUMBER_CLASS, PAGE_BREAK_CLASS, exportBook } from "./export";
import type { TreeNode } from "./model";
import { bookPicturePath } from "./pictures";
import { joinPath } from "./path";
import { encodeImage, type EncodeOptions, type PdfImage } from "./pdfimage";

/**
 * PDF export. The book is exported to manuscript Markdown exactly as the Markdown
 * export does, parsed with the same Markdown dialect the preview uses, then laid
 * out on US Letter pages with the PDF standard fonts. Body text is Helvetica, code
 * is Courier, and pictures are embedded. The result is plain ASCII (picture data is
 * ASCII85 text), so it can be saved through the same text writer as every other export.
 */

export type PdfResult = { pdf: string; pages: number; warnings: string[] };

/** One picture that was read (or could not be) before layout started. */
export type Picture = { image: PdfImage } | { error: string };
export type Pictures = Map<string, Picture>;

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FOOTER_Y = 40;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = MARGIN;
const CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN;

/** F1 Helvetica, F2 Helvetica-Bold, F3 Courier, F4 Helvetica-Oblique, F5 Helvetica-BoldOblique, F6 Symbol. */
type FontKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

const FONT_NAMES: Record<FontKey, string> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Courier",
  F4: "Helvetica-Oblique",
  F5: "Helvetica-BoldOblique",
  F6: "Symbol",
};

// Advance widths for ASCII 32..126, in 1/1000 em. Oblique faces share the upright widths.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Horizontal, vertical, ├-shape, and └-shape box drawing. Other U+2500–U+257F characters become +. */
const BOX_HORIZONTAL = new Set([0x2500, 0x2501, 0x2504, 0x2505, 0x2508, 0x2509, 0x254c, 0x254d, 0x2550]);
const BOX_VERTICAL = new Set([0x2502, 0x2503, 0x2506, 0x2507, 0x250a, 0x250b, 0x254e, 0x254f, 0x2551]);
const BOX_FORK = new Set([0x251c, 0x2523, 0x2560]);
const BOX_ELBOW = new Set([0x2514, 0x2517, 0x255a]);

/**
 * One ASCII column for a box-drawing character. The standard fonts have no such glyphs.
 * ├── is drawn as |-- and └── as `--, and a run of ─ is a run of hyphens.
 */
function boxAscii(cp: number): number | undefined {
  if (cp < 0x2500 || cp > 0x257f) return undefined;
  if (BOX_HORIZONTAL.has(cp)) return 0x2d;
  if (BOX_VERTICAL.has(cp) || BOX_FORK.has(cp)) return 0x7c;
  if (BOX_ELBOW.has(cp)) return 0x60;
  if (cp === 0x2571) return 0x2f;
  if (cp === 0x2572) return 0x5c;
  if (cp === 0x2573) return 0x78;
  return 0x2b;
}

/** WinAnsi byte for one character, or null when the standard fonts cannot show it as itself. */
function winAnsiByte(cp: number): number | null {
  const drawn = boxAscii(cp);
  if (drawn !== undefined) return drawn;
  if (cp === 0x276f) return 0x9b; // ❯ the prompt angle, drawn as ›
  if (cp === 0x23fa) return 0x95; // ⏺ the reply mark, drawn as •
  if (cp === 0x23bf) return 0x60; // ⎿ the result elbow, drawn as `
  if (cp === 0x2212) return 0x2d; // − minus sign, drawn as -
  if (cp === 9) return 32;
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 160 && cp <= 255) return cp;
  const mapped = WIN_ANSI[cp];
  return mapped === undefined ? null : mapped;
}

/** ⁰ and ⁴–⁹ have no superscript glyph in the text fonts. The digit is drawn smaller and raised. */
function raisedDigit(cp: number): number | undefined {
  if (cp === 0x2070) return 0x30;
  if (cp >= 0x2074 && cp <= 0x2079) return 0x30 + (cp - 0x2070);
  return undefined;
}

/** Map text to single-byte WinAnsi codes; anything outside that set becomes "?". A tab is one space here; code expands tabs first. */
function encode(text: string): number[] {
  const codes: number[] = [];
  for (const char of text.normalize("NFC")) codes.push(winAnsiByte(char.codePointAt(0)!) ?? 63);
  return codes;
}

function hasUnshownCharacter(text: string): boolean {
  for (const char of text.normalize("NFC")) {
    const cp = char.codePointAt(0)!;
    if (cp === 10 || cp === 13 || cp === 0x03c0 || cp === 0x03a0) continue;
    if (raisedDigit(cp) !== undefined) continue;
    if (winAnsiByte(cp) === null) return true;
  }
  return false;
}

/** Replace tabs with spaces up to the next multiple of `stop` columns, so indentation lines up. */
export function expandTabs(line: string, stop = 4): string {
  let out = "";
  let column = 0;
  for (const char of line) {
    if (char === "\t") {
      const spaces = stop - (column % stop);
      out += " ".repeat(spaces);
      column += spaces;
    } else {
      out += char;
      column += 1;
    }
  }
  return out;
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
  if (font === "F6") return code === 0x70 ? 549 : code === 0x50 ? 614 : 556;
  const table = font === "F2" || font === "F5" ? HELVETICA_BOLD : HELVETICA;
  return code >= 32 && code <= 126 ? table[code - 32] : 556;
}

function textWidth(codes: number[], font: FontKey, size: number): number {
  let sum = 0;
  for (const code of codes) sum += glyphWidth(code, font);
  return (sum * size) / 1000;
}

/** Text in one font. Spaces inside a `nobreak` run never start a new line (code spans). */
type Run = { text: string; font: FontKey; nobreak?: boolean };
type Piece = { codes: number[]; font: FontKey; rise?: number; scale?: number };

function pieceWidth(piece: Piece, size: number): number {
  return textWidth(piece.codes, piece.font, size * (piece.scale ?? 1));
}

function linePieceWidth(pieces: Piece[], size: number): number {
  return pieces.reduce((sum, piece) => sum + pieceWidth(piece, size), 0);
}

function append(line: Piece[], piece: Piece): void {
  const last = line[line.length - 1];
  if (last && last.font === piece.font && last.rise === piece.rise && last.scale === piece.scale) {
    last.codes.push(...piece.codes);
  } else line.push({ codes: [...piece.codes], font: piece.font, rise: piece.rise, scale: piece.scale });
}

type Glyph = { code: number; font: FontKey; rise?: number; scale?: number };

/** Characters of one run. Pi uses Symbol. A missing superscript digit is a raised digit. */
function glyphs(text: string, font: FontKey): Glyph[] {
  const out: Glyph[] = [];
  for (const char of text.normalize("NFC")) {
    const cp = char.codePointAt(0)!;
    const digit = raisedDigit(cp);
    if (digit !== undefined) {
      out.push({ code: digit, font, rise: 0.35, scale: 0.6 });
      continue;
    }
    if (cp === 0x03c0) {
      out.push({ code: 0x70, font: "F6" });
      continue;
    }
    if (cp === 0x03a0) {
      out.push({ code: 0x50, font: "F6" });
      continue;
    }
    out.push({ code: winAnsiByte(cp) ?? 63, font });
  }
  return out;
}

type Token = { space: Piece } | { word: Piece[] };

/** Cut runs into words and the spaces between them, one list per hard line break. */
function tokenize(runs: Run[]): Token[][] {
  const lines: Token[][] = [[]];
  let word: Piece[] = [];
  const line = () => lines[lines.length - 1];
  const endWord = () => {
    if (word.length) line().push({ word });
    word = [];
  };
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) {
        endWord();
        lines.push([]);
      }
      for (const glyph of glyphs(part, run.font)) {
        if (glyph.code === 32 && !run.nobreak && glyph.rise === undefined && glyph.font === run.font) {
          endWord();
          const tokens = line();
          const last = tokens[tokens.length - 1];
          if (tokens.length > 0 && !(last && "space" in last)) tokens.push({ space: { codes: [32], font: run.font } });
        } else {
          const tail = word[word.length - 1];
          if (tail && tail.font === glyph.font && tail.rise === glyph.rise && tail.scale === glyph.scale) {
            tail.codes.push(glyph.code);
          } else word.push({ codes: [glyph.code], font: glyph.font, rise: glyph.rise, scale: glyph.scale });
        }
      }
    });
  }
  endWord();
  for (const tokens of lines) {
    while (tokens.length && "space" in tokens[tokens.length - 1]) tokens.pop();
  }
  return lines;
}

/** Break runs into lines no wider than `width`. Over-long words are split. */
function wrapRuns(runs: Run[], size: number, width: number): Piece[][] {
  const out: Piece[][] = [];
  for (const tokens of tokenize(runs)) {
    let current: Piece[] = [];
    let currentWidth = 0;
    let gap: Piece | null = null;
    const flush = () => {
      out.push(current);
      current = [];
      currentWidth = 0;
    };
    const placeLong = (word: Piece[]) => {
      // A word wider than a whole line: cut it wherever it reaches the edge.
      for (const piece of word) {
        for (const code of piece.codes) {
          const w = textWidth([code], piece.font, size * (piece.scale ?? 1));
          if (currentWidth + w > width && currentWidth > 0) flush();
          append(current, { codes: [code], font: piece.font, rise: piece.rise, scale: piece.scale });
          currentWidth += w;
        }
      }
    };
    for (const token of tokens) {
      if ("space" in token) {
        gap = token.space;
        continue;
      }
      const wordWidth = linePieceWidth(token.word, size);
      const gapWidth = gap ? pieceWidth(gap, size) : 0;
      if (current.length === 0) {
        if (wordWidth <= width) {
          for (const piece of token.word) append(current, piece);
          currentWidth = wordWidth;
        } else placeLong(token.word);
      } else if (currentWidth + gapWidth + wordWidth <= width) {
        if (gap) append(current, gap);
        for (const piece of token.word) append(current, piece);
        currentWidth += gapWidth + wordWidth;
      } else {
        flush();
        if (wordWidth <= width) {
          for (const piece of token.word) append(current, piece);
          currentWidth = wordWidth;
        } else placeLong(token.word);
      }
      gap = null;
    }
    flush();
  }
  return out;
}

type TextItem = { kind: "text"; pieces: Piece[]; size: number; x: number; y: number; gray?: number };
type RuleItem = { kind: "rule"; y: number };
type RectItem = { kind: "rect"; x: number; y: number; w: number; h: number; gray: number };
type ImageItem = { kind: "image"; index: number; x: number; y: number; w: number; h: number; orientation: number };
type Item = TextItem | RuleItem | RectItem | ImageItem;

type TextOptions = {
  font: FontKey;
  size: number;
  indent?: number;
  leading?: number;
  after?: number;
  before?: number;
  bullet?: string;
  keepWithNext?: number;
  center?: boolean;
};

const CODE_SIZE = 9;
const CODE_LEADING = 11.5;
const CODE_PAD = 5;
const CODE_RULE = 2;

/** A run of blocks that must not be left behind when the next block starts a new page. */
type Hold = { index: number; cursor: number; yAfter: number };

class Layout {
  pages: Item[][] = [[]];
  y = PAGE_HEIGHT - MARGIN;
  images: PdfImage[] = [];
  /**
   * The chapter line and the headings under it. `keepWithNext` only reserves a
   * fixed gap, which is shorter than the heading that follows, so a chapter
   * number was left at the bottom of the previous page. The whole run moves
   * with the block that did not fit.
   */
  private hold: Hold | null = null;

  private get page(): Item[] {
    return this.pages[this.pages.length - 1];
  }

  newPage(): void {
    this.pages.push([]);
    this.y = PAGE_HEIGHT - MARGIN;
    this.hold = null;
  }

  /** True when this page already holds something, so a page break starts the next page. */
  hasContent(): boolean {
    return this.page.length > 0;
  }

  /**
   * Start a new page unless `height` still fits. `gap` is reapplied above the
   * block when a kept run moves with it. Returns true when a new page was opened.
   */
  need(height: number, gap = 0): boolean {
    if (this.y - height >= BOTTOM || this.page.length === 0) return false;
    const hold = this.hold;
    if (hold && hold.index < this.page.length && hold.cursor > hold.yAfter) {
      const yAfter = PAGE_HEIGHT - MARGIN - (hold.cursor - hold.yAfter);
      if (yAfter - gap - height >= BOTTOM) {
        const carried = this.page.splice(hold.index);
        const shift = PAGE_HEIGHT - MARGIN - hold.cursor;
        this.hold = null;
        this.newPage();
        for (const item of carried) item.y += shift;
        this.page.push(...carried);
        this.y = yAfter - gap;
        return true;
      }
    }
    this.hold = null;
    this.newPage();
    return true;
  }

  text(content: string | Run[], options: TextOptions): void {
    const indent = options.indent ?? 0;
    const leading = options.leading ?? options.size * 1.35;
    const runs = typeof content === "string" ? [{ text: content, font: options.font }] : content;
    const lines = wrapRuns(runs, options.size, TEXT_WIDTH - indent);
    const gap = options.before && this.page.length > 0 ? options.before : 0;
    this.y -= gap;
    this.need(leading * Math.min(lines.length, 2) + (options.keepWithNext ?? 0), gap);
    const origin = this.page.length;
    const cursor = this.y;
    let moved = false;
    lines.forEach((pieces, index) => {
      if (this.y - leading < BOTTOM) {
        this.newPage();
        moved = true;
      }
      this.y -= leading;
      if (index === 0 && options.bullet) {
        const bullet: Piece = { codes: encode(options.bullet), font: options.font };
        this.page.push({ kind: "text", pieces: [bullet], size: options.size, x: MARGIN + indent - 14, y: this.y });
      }
      const x = options.center
        ? MARGIN + indent + (TEXT_WIDTH - indent - linePieceWidth(pieces, options.size)) / 2
        : MARGIN + indent;
      this.page.push({ kind: "text", pieces, size: options.size, x, y: this.y });
    });
    this.y -= options.after ?? 0;
    if (options.keepWithNext && !moved) {
      if (this.hold && this.hold.index <= origin) this.hold.yAfter = this.y;
      else this.hold = { index: origin, cursor, yAfter: this.y };
    } else this.hold = null;
  }

  rule(): void {
    this.need(12);
    this.y -= 6;
    this.page.push({ kind: "rule", y: this.y });
    this.y -= 6;
    this.hold = null;
  }

  /**
   * A block of code: Courier, every line kept as written (tabs expanded to 4 columns),
   * over-long lines cut at the box edge and marked with a grey continuation sign.
   * The shaded box is drawn once per page, so a long block may split between pages.
   */
  code(source: string, indent: number): void {
    const boxX = MARGIN + indent;
    const boxWidth = TEXT_WIDTH - indent;
    const columns = Math.max(8, Math.floor((boxWidth - CODE_RULE - 2 * CODE_PAD - 6) / (0.6 * CODE_SIZE)));
    const rows: { codes: number[]; more: boolean }[] = [];
    for (const line of source.split("\n")) {
      const codes = encode(expandTabs(line));
      if (codes.length === 0) rows.push({ codes, more: false });
      for (let at = 0; at < codes.length; at += columns) {
        rows.push({ codes: codes.slice(at, at + columns), more: at + columns < codes.length });
      }
    }
    if (this.page.length > 0) this.y -= 2;
    let done = 0;
    while (done < rows.length) {
      const remaining = rows.length - done;
      const room = Math.floor((this.y - BOTTOM - 2 * CODE_PAD) / CODE_LEADING);
      let take = Math.min(room, remaining);
      // No lone first or last line of a block on a page of its own.
      if (take < remaining && remaining - take === 1 && take > 2) take -= 1;
      if (take < Math.min(2, remaining)) {
        if (this.page.length === 0) take = 1;
        else {
          const fitsWithHeading = done === 0 && this.need(Math.min(2, remaining) * CODE_LEADING + 2 * CODE_PAD, 2);
          if (!fitsWithHeading) this.newPage();
          continue;
        }
      }
      const height = take * CODE_LEADING + 2 * CODE_PAD;
      const top = this.y;
      this.page.push({ kind: "rect", x: boxX, y: top - height, w: boxWidth, h: height, gray: 0.95 });
      this.page.push({ kind: "rect", x: boxX, y: top - height, w: CODE_RULE, h: height, gray: 0.7 });
      for (let k = 0; k < take; k++) {
        const row = rows[done + k];
        const baseline = top - CODE_PAD - (k + 1) * CODE_LEADING + 3;
        const x = boxX + CODE_RULE + CODE_PAD;
        if (row.codes.length > 0) {
          this.page.push({ kind: "text", pieces: [{ codes: row.codes, font: "F3" }], size: CODE_SIZE, x, y: baseline });
        }
        if (row.more) {
          this.page.push({
            kind: "text",
            pieces: [{ codes: [0xbb], font: "F3" }],
            size: CODE_SIZE,
            x: boxX + boxWidth - CODE_PAD - 4,
            y: baseline,
            gray: 0.45,
          });
        }
      }
      this.y = top - height;
      done += take;
      this.hold = null;
      if (done < rows.length) this.newPage();
    }
    this.y -= 8;
  }

  /** Place a picture (never split across pages) with an optional centred caption. */
  figure(image: PdfImage, key: number, size: { width?: number; height?: number }, indent: number, caption: string): void {
    const available = TEXT_WIDTH - indent;
    const sideways = image.orientation >= 5;
    const shownWidth = sideways ? image.height : image.width;
    const shownHeight = sideways ? image.width : image.height;
    const captionLines = caption ? wrapRuns([{ text: caption, font: "F4" }], 9.5, available).length : 0;
    const captionHeight = captionLines ? captionLines * 9.5 * 1.35 + 4 : 0;
    const maxHeight = CONTENT_HEIGHT - captionHeight - 12;
    // Natural size is 96 pixels to the inch; a picture is never enlarged unless asked.
    let w = size.width ?? (size.height ? (size.height * shownWidth) / shownHeight : shownWidth * 0.75);
    let h = size.height ?? (size.width ? (size.width * shownHeight) / shownWidth : shownHeight * 0.75);
    const shrink = Math.min(1, available / w, maxHeight / h);
    w *= shrink;
    h *= shrink;
    this.y -= 4;
    this.need(h + captionHeight + 8, 4);
    const x = MARGIN + indent + (available - w) / 2;
    this.y -= h;
    this.page.push({ kind: "image", index: key, x, y: this.y, w, h, orientation: image.orientation });
    this.y -= 4;
    if (captionLines) {
      this.y -= 2;
      this.text(caption, { font: "F4", size: 9.5, indent, center: true, after: 6 });
    } else this.y -= 4;
    this.hold = null;
  }
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.use(footnote);

type MdToken = ReturnType<typeof md.parse>[number];

const HEADING_SIZE = [0, 24, 19, 16, 14, 12, 11];

/** Nearest font for the given base face with bold and italic switched on. */
function styled(base: FontKey, bold: boolean, italic: boolean): FontKey {
  const heavy = bold || base === "F2" || base === "F5";
  const slanted = italic || base === "F4" || base === "F5";
  if (heavy && slanted) return "F5";
  if (heavy) return "F2";
  return slanted ? "F4" : "F1";
}

type PictureRef = { src: string; alt: string; width?: number; height?: number };
type Segment = { runs: Run[] } | { picture: PictureRef; alone: boolean };

const SIZE_UNITS: Record<string, number> = { "": 0.75, px: 0.75, pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, em: 11, rem: 11 };

/** The `{width=30% height=2in}` block that may follow a picture, as points. `available` is the line width. */
function pictureSize(block: string, available: number): { width?: number; height?: number } {
  const read = (name: string, whole: number): number | undefined => {
    const found = new RegExp(`(?:^|\\s)${name}=(\\S+)`).exec(block);
    const parsed = found ? /^([\d.]+)(%|[a-z]*)$/.exec(found[1]) : null;
    if (!parsed) return undefined;
    const amount = Number(parsed[1]);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    if (parsed[2] === "%") return (amount / 100) * whole;
    const factor = SIZE_UNITS[parsed[2]];
    return factor === undefined ? undefined : amount * factor;
  };
  return { width: read("width", available), height: read("height", CONTENT_HEIGHT) };
}

/**
 * Split an inline token into text runs and pictures. Code spans keep Courier, and
 * emphasis and strong text switch between the Helvetica faces. Pictures end the text
 * before them; `alone` marks a paragraph that holds nothing else, which gets a caption.
 */
function inlineSegments(token: MdToken, base: FontKey, available: number): Segment[] {
  const segments: Segment[] = [];
  let runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  const font = () => styled(base, bold > 0, italic > 0);
  const flush = () => {
    if (runs.length) segments.push({ runs });
    runs = [];
  };
  const children = token.children ?? [];
  let skip = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    switch (child.type) {
      case "text": {
        const text = skip ? child.content.slice(skip) : child.content;
        skip = 0;
        if (text) runs.push({ text, font: font() });
        break;
      }
      case "code_inline":
        runs.push({ text: child.content, font: "F3", nobreak: child.content.length <= 40 });
        break;
      case "strong_open":
        bold += 1;
        break;
      case "strong_close":
        bold -= 1;
        break;
      case "em_open":
        italic += 1;
        break;
      case "em_close":
        italic -= 1;
        break;
      case "softbreak":
        runs.push({ text: " ", font: font() });
        break;
      case "hardbreak":
        runs.push({ text: "\n", font: font() });
        break;
      case "footnote_ref":
        runs.push({ text: `[${Number((child.meta as { id?: number } | null)?.id ?? 0) + 1}]`, font: font() });
        break;
      case "image": {
        flush();
        const next = children[i + 1];
        let size: { width?: number; height?: number } = {};
        const block = next?.type === "text" ? /^\{([^{}]*)\}/.exec(next.content) : null;
        if (block) {
          size = pictureSize(block[1], available);
          skip = block[0].length;
        }
        segments.push({ picture: { src: String(child.attrGet("src") ?? ""), alt: child.content, ...size }, alone: false });
        break;
      }
      default:
        break;
    }
  }
  flush();
  const blank = (segment: Segment) => "runs" in segment && segment.runs.every((run) => run.text.trim() === "");
  const meaningful = segments.filter((segment) => !blank(segment));
  if (meaningful.length === 1 && "picture" in meaningful[0]) meaningful[0].alone = true;
  return segments.filter((segment) => !blank(segment) || "picture" in segment);
}

function plainRuns(segments: Segment[]): Run[] {
  const out: Run[] = [];
  for (const segment of segments) {
    if ("runs" in segment) out.push(...segment.runs);
    else out.push({ text: `[${segment.picture.alt || "image"}]`, font: "F4" });
  }
  return out;
}

/** The picture files a Markdown text refers to, as written. */
export function pictureSources(markdown: string): string[] {
  const found = new Set<string>();
  const visit = (tokens: MdToken[]) => {
    for (const token of tokens) {
      if (token.type === "image") {
        const src = String(token.attrGet("src") ?? "");
        if (src) found.add(src);
      }
      if (token.children) visit(token.children);
    }
  };
  visit(md.parse(markdown, {}));
  return [...found];
}

/**
 * Read every picture the Markdown uses through the book's file layer, exactly as the
 * preview locates them (relative to the book folder, never outside it). A picture
 * that cannot be read or decoded is recorded as an error and shown as its alt text.
 */
export async function loadPictures(fs: Fs, root: string, markdown: string, options: EncodeOptions = {}): Promise<Pictures> {
  const pictures: Pictures = new Map();
  for (const src of pictureSources(markdown)) {
    const relative = bookPicturePath(src);
    if (relative === false) {
      pictures.set(src, { error: "web pictures are not fetched" });
      continue;
    }
    if (relative === null) {
      pictures.set(src, { error: "the picture is outside the book folder" });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readBytes(joinPath(root, relative));
    } catch (error) {
      pictures.set(src, { error: `the file could not be read (${String(error).replace(/^Error:\s*/, "")})` });
      continue;
    }
    try {
      pictures.set(src, { image: await encodeImage(bytes, options) });
    } catch (error) {
      pictures.set(src, { error: (error as Error).message });
    }
  }
  return pictures;
}

/** The "Part N" or "Chapter N" line, when this paragraph is that opener. */
function divisionLine(content: string): string | null {
  const matched = new RegExp(`^<p class="${CHAPTER_NUMBER_CLASS}">((?:Part|Chapter) \\d+)</p>$`).exec(content.trim());
  return matched?.[1] ?? null;
}

function layoutTokens(tokens: MdToken[], layout: Layout, warnings: string[], pictures: Pictures | undefined): void {
  type ListState = { ordered: boolean; count: number };
  const lists: ListState[] = [];
  let quote = 0;
  let pendingBullet: string | null = null;
  let heading = 0;
  let chapterLead = false;
  let inNotes = false;
  let noteNumber = 0;
  let row: Run[][] | null = null;
  let headerRow = false;
  let noteFirst = false;
  const warned = new Set<string>();
  const imageKeys = new Map<string, number>();

  const indent = () => lists.length * 22 + quote * 18 + (inNotes ? 14 : 0);

  const place = (picture: PictureRef, alone: boolean): void => {
    const known = pictures?.get(picture.src);
    if (known && "image" in known) {
      let key = imageKeys.get(picture.src);
      if (key === undefined) {
        key = layout.images.length;
        layout.images.push(known.image);
        imageKeys.set(picture.src, key);
      }
      layout.figure(known.image, key, picture, indent(), alone ? picture.alt : "");
      return;
    }
    if (!warned.has(picture.src)) {
      warned.add(picture.src);
      const reason = known && "error" in known ? known.error : "pictures were not loaded";
      warnings.push(`Picture "${picture.src}" is not in the PDF: ${reason}.`);
    }
    layout.text(`[${picture.alt || "image"}]`, { font: "F4", size: 11, indent: indent(), leading: 15, after: 8 });
  };

  const paragraph = (runs: Run[]) => {
    const bullet = pendingBullet ?? undefined;
    pendingBullet = null;
    layout.text(runs, { font: "F1", size: 11, indent: indent(), leading: 15, after: lists.length ? 3 : 8, bullet });
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case "heading_open":
        heading = Number(token.tag.slice(1));
        break;
      case "heading_close":
        heading = 0;
        chapterLead = false;
        break;
      case "html_block": {
        if (token.content.trim() === `<div class="${PAGE_BREAK_CLASS}"></div>`) {
          if (layout.hasContent()) layout.newPage();
          break;
        }
        const opener = divisionLine(token.content);
        if (opener) {
          layout.text(opener, { font: "F2", size: 13, before: 22, after: 0, center: true, keepWithNext: 48 });
          chapterLead = true;
          break;
        }
        if (!warned.has("html")) {
          warned.add("html");
          warnings.push("Raw HTML is not shown in the PDF.");
        }
        break;
      }
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
        if (row) {
          const cells: Run[] = [];
          row.forEach((cell, index) => {
            if (index > 0) cells.push({ text: "  |  ", font: headerRow ? "F2" : "F1" });
            cells.push(...cell);
          });
          layout.text(cells, { font: headerRow ? "F2" : "F1", size: 10, indent: indent(), after: 2 });
        }
        row = null;
        headerRow = false;
        break;
      case "hr":
        layout.rule();
        break;
      case "fence":
      case "code_block":
        layout.code(token.content.replace(/\n$/, ""), indent());
        break;
      case "inline": {
        const available = TEXT_WIDTH - indent();
        if (row) {
          row.push(plainRuns(inlineSegments(token, headerRow ? "F2" : "F1", available)));
        } else if (heading) {
          const clean = plainRuns(inlineSegments(token, "F2", available));
          const last = clean[clean.length - 1];
          if (last) last.text = last.text.replace(/\s*\{-\}\s*$/, "");
          const before = chapterLead ? 4 : heading <= 2 ? 18 : 12;
          layout.text(clean, { font: "F2", size: HEADING_SIZE[heading], before, after: 6, keepWithNext: 40 });
        } else if (inNotes) {
          const label = noteFirst ? `${noteNumber}.` : undefined;
          noteFirst = false;
          layout.text(plainRuns(inlineSegments(token, "F1", available)), { font: "F1", size: 9.5, indent: indent(), after: 3, bullet: label });
        } else {
          for (const segment of inlineSegments(token, "F1", available)) {
            if ("picture" in segment) {
              place(segment.picture, segment.alone);
              continue;
            }
            const text = segment.runs.map((run) => run.text).join("").trim();
            if (text === `<div class="${PAGE_BREAK_CLASS}"></div>`) {
              if (layout.hasContent()) layout.newPage();
              continue;
            }
            const opener = divisionLine(text);
            if (opener) {
              layout.text(opener, { font: "F2", size: 13, before: 22, after: 0, center: true, keepWithNext: 48 });
              chapterLead = true;
              continue;
            }
            paragraph(segment.runs);
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/** PDF matrix that puts the stored picture into a `w` by `h` box at (x, y) as its EXIF orientation says. */
function imageMatrix(item: ImageItem): string {
  const { x, y, w, h } = item;
  const m: Record<number, number[]> = {
    1: [w, 0, 0, h, x, y],
    2: [-w, 0, 0, h, x + w, y],
    3: [-w, 0, 0, -h, x + w, y + h],
    4: [w, 0, 0, -h, x, y + h],
    5: [0, -h, -w, 0, x + w, y + h],
    6: [0, -h, w, 0, x, y + h],
    7: [0, h, w, 0, x, y],
    8: [0, h, -w, 0, x + w, y],
  };
  return (m[item.orientation] ?? m[1]).map((n) => String(Math.round(n * 1000) / 1000)).join(" ");
}

function assemble(layout: Layout, title: string): string {
  const pageCount = layout.pages.length;
  const objects: string[] = [];
  const fontKeys = Object.keys(FONT_NAMES) as FontKey[];
  const INFO_ID = 3 + fontKeys.length;
  const FIRST_PAGE = INFO_ID + 1;
  const firstImage = FIRST_PAGE + pageCount * 2;
  // Each picture takes one object, or two when it has a soft mask.
  const imageIds: number[] = [];
  const maskIds: (number | null)[] = [];
  let nextId = firstImage;
  for (const image of layout.images) {
    imageIds.push(nextId++);
    maskIds.push(image.alpha ? nextId++ : null);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = layout.pages.map((_, index) => `${FIRST_PAGE + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  fontKeys.forEach((key, index) => {
    const encoding = key === "F6" ? "" : " /Encoding /WinAnsiEncoding";
    objects[3 + index] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[key]}${encoding} >>`;
  });
  objects[INFO_ID] = `<< /Title ${pdfString(encode(title))} /Producer (Bookwriter) >>`;

  layout.pages.forEach((items, index) => {
    let content = "";
    const used = new Set<number>();
    for (const item of items) {
      if (item.kind === "rule") {
        content += `0.6 G 0.5 w ${MARGIN} ${item.y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${item.y.toFixed(2)} l S\n`;
      } else if (item.kind === "rect") {
        content += `${item.gray} g ${item.x.toFixed(2)} ${item.y.toFixed(2)} ${item.w.toFixed(2)} ${item.h.toFixed(2)} re f\n`;
      } else if (item.kind === "image") {
        used.add(item.index);
        content += `q ${imageMatrix(item)} cm /Im${item.index} Do Q\n`;
      } else {
        const visible = item.pieces.filter((piece) => piece.codes.length > 0);
        if (visible.length === 0) continue;
        content += `BT ${item.gray === undefined ? "0 g" : `${item.gray} g`} ${item.x.toFixed(2)} ${item.y.toFixed(2)} Td`;
        for (const piece of visible) {
          const size = piece.scale ? (item.size * piece.scale).toFixed(2) : String(item.size);
          content += ` /${piece.font} ${size} Tf`;
          if (piece.rise) content += ` ${(item.size * piece.rise).toFixed(2)} Ts`;
          content += ` ${pdfString(piece.codes)} Tj`;
          if (piece.rise) content += " 0 Ts";
        }
        content += " ET\n";
      }
    }
    const label = pdfString(encode(String(index + 1)));
    const width = textWidth(encode(String(index + 1)), "F1", 9);
    content += `0 g BT /F1 9 Tf ${((PAGE_WIDTH - width) / 2).toFixed(2)} ${FOOTER_Y} Td ${label} Tj ET\n`;
    const pageId = FIRST_PAGE + index * 2;
    const xobjects = used.size
      ? ` /XObject << ${[...used].map((key) => `/Im${key} ${imageIds[key]} 0 R`).join(" ")} >>`
      : "";
    const fonts = fontKeys.map((key, n) => `/${key} ${3 + n} 0 R`).join(" ");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << ${fonts} >>${xobjects} >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
  });

  layout.images.forEach((image, index) => {
    const mask = maskIds[index];
    const filters = image.filters.map((name) => `/${name}`).join(" ");
    const parts = [
      "/Type /XObject /Subtype /Image",
      `/Width ${image.width} /Height ${image.height}`,
      `/ColorSpace ${image.colorSpace} /BitsPerComponent ${image.bpc}`,
      `/Filter [${filters}]`,
    ];
    if (image.extra) parts.push(image.extra);
    if (mask !== null) parts.push(`/SMask ${mask} 0 R`);
    parts.push(`/Length ${image.data.length}`);
    objects[imageIds[index]] = `<< ${parts.join(" ")} >>\nstream\n${image.data}\nendstream`;
    if (mask !== null && image.alpha) {
      objects[mask] =
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter [/ASCII85Decode /FlateDecode] /Length ${image.alpha.length} >>\n` +
        `stream\n${image.alpha}\nendstream`;
    }
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
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${INFO_ID} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/** Render Markdown to a PDF document held as an ASCII string. Pictures come from `pictures` (see `loadPictures`). */
export function markdownToPdf(markdown: string, title = "", pictures?: Pictures): PdfResult {
  const warnings: string[] = [];
  const layout = new Layout();
  layoutTokens(md.parse(markdown, {}), layout, warnings, pictures);
  if (hasUnshownCharacter(markdown)) {
    warnings.push("Some characters cannot be shown in the PDF and were replaced with ?.");
  }
  return { pdf: assemble(layout, title), pages: layout.pages.length, warnings };
}

/** The whole book as a PDF: the same manuscript the Markdown export writes. */
export function exportPdf(nodes: TreeNode[], title = "", pictures?: Pictures): PdfResult {
  const exported = exportBook(nodes);
  const rendered = markdownToPdf(exported.markdown, title, pictures);
  return { ...rendered, warnings: [...exported.warnings, ...rendered.warnings] };
}

/** Like `exportPdf`, but first reads the book's pictures from `root` through `fs`. */
export async function exportPdfWithPictures(
  nodes: TreeNode[],
  title: string,
  fs: Fs,
  root: string,
  options: EncodeOptions = {},
): Promise<PdfResult> {
  const exported = exportBook(nodes);
  const pictures = await loadPictures(fs, root, exported.markdown, options);
  const rendered = markdownToPdf(exported.markdown, title, pictures);
  return { ...rendered, warnings: [...exported.warnings, ...rendered.warnings] };
}
