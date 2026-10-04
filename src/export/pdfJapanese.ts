import { create, type Font, type FontCollection } from "fontkit";
import regularData from "./fonts/regular.json";
import boldData from "./fonts/bold.json";
import { ascii85 } from "./pdfimage";

export type JapaneseFontKey = "J1" | "J2";
// fontkit 2 accepts Uint8Array in browsers; @types/fontkit still requires Node Buffer.
const createFont = create as (bytes: Uint8Array) => Font | FontCollection;
const fonts = new Map<JapaneseFontKey, Font>();
const fontBytes = new Map<JapaneseFontKey, Uint8Array>();
const fontStreams = new Map<JapaneseFontKey, string>();

function bytesFor(key: JapaneseFontKey): Uint8Array {
  let bytes = fontBytes.get(key);
  if (!bytes) {
    const data = key === "J2" ? boldData : regularData;
    bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    fontBytes.set(key, bytes);
  }
  return bytes;
}

function fontFor(key: JapaneseFontKey): Font {
  let font = fonts.get(key);
  if (!font) {
    const decoded = createFont(bytesFor(key));
    if (!("glyphForCodePoint" in decoded)) throw new Error("Expected a single Japanese font face");
    font = decoded;
    fonts.set(key, font);
  }
  return font;
}

export function isJapaneseFont(key: string): key is JapaneseFontKey {
  return key === "J1" || key === "J2";
}

export function hasJapaneseGlyph(cp: number, key: JapaneseFontKey = "J1"): boolean {
  return fontFor(key).hasGlyphForCodePoint(cp);
}

export function japaneseWidth(cp: number, key: JapaneseFontKey): number {
  const font = fontFor(key);
  return font.glyphForCodePoint(cp).advanceWidth * 1000 / font.unitsPerEm;
}

export function unicodeHex(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  return hex.toUpperCase();
}

function hexCode(value: number): string {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

function stream(data: string, dictionary = ""): string {
  return `<< /Length ${data.length} ${dictionary} >>\nstream\n${data}\nendstream`;
}

/** OS/2 v0/v1 fonts omit sCapHeight; OpenType permits measuring capital H. */
function capHeight(font: Font): number {
  const height = Number.isFinite(font.capHeight) ? font.capHeight
    : font.hasGlyphForCodePoint(0x48) ? font.glyphForCodePoint(0x48).bbox.maxY : 0;
  const scaled = Math.round(height * 1000 / font.unitsPerEm);
  return Number.isFinite(scaled) ? scaled : 0;
}

/** Per-document character IDs: Unicode aliases may share a glyph but must extract separately. */
export class JapanesePdfFont {
  private readonly characters = new Map<number, number>();

  constructor(readonly key: JapaneseFontKey) {}

  encode(codes: number[]): string {
    return "<" + codes.map((cp) => {
      let cid = this.characters.get(cp);
      if (cid === undefined) {
        cid = this.characters.size + 1;
        this.characters.set(cp, cid);
      }
      return hexCode(cid);
    }).join("") + ">";
  }

  write(objects: string[], id: number): void {
    const font = fontFor(this.key);
    const widths: number[] = [];
    const gids = new Uint8Array((this.characters.size + 1) * 2);
    const mappings: string[] = [];
    for (const [cp, cid] of this.characters) {
      const gid = font.glyphForCodePoint(cp).id;
      gids[cid * 2] = gid >> 8;
      gids[cid * 2 + 1] = gid & 255;
      widths.push(japaneseWidth(cp, this.key));
      mappings.push(`<${hexCode(cid)}> <${unicodeHex(String.fromCodePoint(cp))}>`);
    }
    // Preserve the original font's tables, alignment, and checksums. fontkit's
    // PDF-only subsets omit tables and emit an unsorted, unaligned directory
    // with zero checksums. Avoid relying on a viewer to repair that structure.
    const bytes = bytesFor(this.key);
    let encoded = fontStreams.get(this.key);
    if (!encoded) {
      encoded = ascii85(bytes);
      fontStreams.set(this.key, encoded);
    }
    const add = (value: string): number => objects.push(value) - 1;
    const fileId = add(stream(encoded, `/Filter /ASCII85Decode /Length1 ${bytes.length}`));
    const gidId = add(stream(ascii85(gids), "/Filter /ASCII85Decode"));
    const cmapId = add(stream(toUnicode(mappings)));
    const name = font.postscriptName;
    const scale = 1000 / font.unitsPerEm;
    const bbox = [font.bbox.minX, font.bbox.minY, font.bbox.maxX, font.bbox.maxY].map((n) => Math.round(n * scale));
    const descriptorId = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${bbox.join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} /CapHeight ${capHeight(font)} /StemV ${this.key === "J2" ? 120 : 80} /FontFile2 ${fileId} 0 R >>`);
    const descendantId = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /W [1 [${widths.join(" ")}]] /CIDToGIDMap ${gidId} 0 R >>`);
    objects[id] = `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${descendantId} 0 R] /ToUnicode ${cmapId} 0 R >>`;
  }
}

function toUnicode(mappings: string[]): string {
  const chunks: string[] = [];
  for (let i = 0; i < mappings.length; i += 100) {
    const chunk = mappings.slice(i, i + 100);
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /BookwriterUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}
