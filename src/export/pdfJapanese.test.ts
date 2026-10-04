import { describe, expect, it } from "vitest";
import { markdownToPdf } from "./pdf";
import { makePng, unascii85 } from "../imageFixtures";
import { encodeImage } from "./pdfimage";

describe("Japanese PDF export", () => {
  it("embeds readable and extractable Japanese in headings, body, and code", () => {
    const result = markdownToPdf('# 日本語の本\n\nこんにちは。**太字**と English の混在。\n\n```ts\nconst 名前 = "東京";\n```', "日本語の本");
    expect(result.warnings).toEqual([]);
    expect(result.pdf).toContain("/Subtype /Type0");
    expect(result.pdf).toContain("/ToUnicode");
    expect(result.pdf).toContain("/FontFile2");
    expect(result.pdf).toContain("<FEFF65E5672C8A9E306E672C>");
    expect(/^[\x00-\x7f]*$/.test(result.pdf)).toBe(true);
  });

  it("wraps Japanese without spaces across multiple pages", () => {
    const result = markdownToPdf("日本語の長い文章を正しく折り返します。".repeat(500));
    expect(result.warnings).toEqual([]);
    expect(result.pages).toBeGreaterThan(3);
  });

  it("identifies unsupported characters instead of silently substituting question marks", () => {
    const result = markdownToPdf("絵文字😀と未割当\u{10ffff}");
    expect(result.warnings.join(" ")).toContain("U+1F600");
    expect(result.warnings.join(" ")).toContain("U+10FFFF");
    expect(result.pdf).toContain("[U+1F600]");
    expect(result.pdf).toContain("[U+10FFFF]");
  });
});

describe("Japanese PDF font isolation", () => {
  it("keeps Latin-only PDFs small and free of embedded Japanese fonts", () => {
    markdownToPdf("日本語");
    const result = markdownToPdf("# Latin title\n\nHello **world**.\n\n```\nconst value = 1;\n```");
    expect(result.pdf).not.toContain("/FontFile2");
    expect(result.pdf).toContain("(Latin title)");
    expect(result.pdf).toContain("(const value = 1;)");
    expect(result.pdf.length).toBeLessThan(5000);
    expect(result.warnings).toEqual([]);
  });

  it("maps each PDF independently and normalizes decomposed kana", () => {
    const first = markdownToPdf("がぱ").pdf;
    markdownToPdf("全く別の文書");
    expect(markdownToPdf("か\u3099は\u309a").pdf).toEqual(first);
  });

  it("measures fullwidth and halfwidth Japanese at code tab stops", async () => {
    const { expandTabs } = await import("./pdf");
    expect(expandTabs("日\t本")).toBe("日  本");
    expect(expandTabs("ｶﾅ\t本")).toBe("ｶﾅ  本");
  });
});

// Check the actual embedded sfnt, independently of the font writer. Lenient PDF
// renderers can display a malformed subset that stricter font loaders reject.
function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const word = ((bytes[i] ?? 0) * 0x1000000) + ((bytes[i + 1] ?? 0) << 16)
      + ((bytes[i + 2] ?? 0) << 8) + (bytes[i + 3] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

it("embeds structurally complete Japanese fonts alongside transparent pictures", async () => {
  const image = await encodeImage(makePng({ width: 1, height: 1, colorType: 6, rows: [[20, 100, 200, 128]] }));
  const result = markdownToPdf("# 日本語の見出し\n\n画像の前。\n\n![日本語の図](image.png)\n\n画像の後。", "", new Map([["image.png", { image }]]));
  expect(result.warnings).toEqual([]);
  expect(result.pdf).toContain("/SMask");
  const streams = [...result.pdf.matchAll(/<< \/Length \d+ \/Filter \/ASCII85Decode \/Length1 (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
  expect(streams).toHaveLength(2);
  for (const stream of streams) {
    const bytes = unascii85(stream[2]);
    expect(bytes.length).toBe(Number(stream[1]));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([0x00010000, 0x74727565]).toContain(view.getUint32(0));
    expect(checksum(bytes)).toBe(0xb1b0afba);
    const tags: string[] = [];
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + i * 16;
      const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
      tags.push(tag);
      const offset = view.getUint32(record + 8), length = view.getUint32(record + 12);
      expect(offset % 4).toBe(0);
      expect(offset + length).toBeLessThanOrEqual(bytes.length);
      const table = bytes.slice(offset, offset + length);
      if (tag === "head") table.fill(0, 8, 12);
      expect(checksum(table)).toBe(view.getUint32(record + 4));
    }
    expect(tags).toEqual([...tags].sort());
    for (const tag of ["cmap", "name", "post", "OS/2", "glyf", "loca"]) expect(tags).toContain(tag);
  }
});

// OS/2 v1 fonts omit sCapHeight. Check the serialized descriptors themselves:
// lenient renderers can silently accept invalid tokens such as NaN as null.
it.each([
  ["heading and body", "# 日本語の見出し\n\n日本語の本文。", 2],
  ["regular body", "日本語の本文。", 1],
  ["bold body", "**日本語の太字。**", 1],
  ["code", "```ts\nconst 名前 = '東京';\n```", 1],
])("writes finite font descriptor metrics for %s", (_label, markdown, count) => {
  const pdf = markdownToPdf(markdown as string).pdf;
  const descriptors = [...pdf.matchAll(/<< \/Type \/FontDescriptor [^>]+ >>/g)];
  expect(descriptors).toHaveLength(count as number);
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  for (const [descriptor] of descriptors) {
    for (const key of ["Flags", "ItalicAngle", "Ascent", "Descent", "CapHeight", "StemV"]) {
      const value = new RegExp(`/${key} (\\S+)`).exec(descriptor)?.[1];
      expect(value, key).toMatch(number);
      expect(Number.isFinite(Number(value)), key).toBe(true);
    }
    const bounds = /\/FontBBox \[([^\]]+)\]/.exec(descriptor)?.[1].split(/\s+/);
    expect(bounds).toHaveLength(4);
    for (const value of bounds!) {
      expect(value).toMatch(number);
      expect(Number.isFinite(Number(value))).toBe(true);
    }
    expect(Number(/\/CapHeight (\S+)/.exec(descriptor)![1])).toBeGreaterThan(0);
  }
});
