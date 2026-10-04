import { describe, expect, it } from "vitest";
import { markdownToPdf } from "./pdf";

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

  it("subsets each PDF independently and normalizes decomposed kana", () => {
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
