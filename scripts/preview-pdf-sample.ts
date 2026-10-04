import { writeFileSync } from "node:fs";
import { markdownToPdf, type Pictures } from "../src/export/pdf";
import { encodeImage } from "../src/export/pdfimage";
import { makePng } from "../src/imageFixtures";

// Self-authored fixture; no private manuscript or external image dependencies.
const pictures: Pictures = new Map();
for (const alpha of [false, true]) {
  const image = await encodeImage(makePng({
    width: 80,
    height: 40,
    colorType: alpha ? 6 : 2,
    rows: Array.from({ length: 40 }, () =>
      Array.from({ length: 80 }, () => alpha ? [20, 100, 200, 128] : [20, 100, 200]).flat()),
  }));
  pictures.set(alpha ? "alpha.png" : "rgb.png", { image });
}
const source = [
  "# 日本語の見出し Japanese heading",
  "画像の前に日本語があります。 **太字の確認です。**",
  "![図の説明 日本語](rgb.png)",
  "画像の後に日本語があります。",
  "![透明な図の説明](alpha.png)",
  "最後の本文と漢字ひらがなカタカナ。",
  '```ts\nconst 記録 = "画像と日本語";\n```',
].join("\n\n");
const result = markdownToPdf(source, "日本語と画像", pictures);
if (result.warnings.length) throw new Error(result.warnings.join("\n"));
const output = process.argv[2] ?? "/tmp/bookwriter-preview-sample.pdf";
writeFileSync(output, result.pdf, "ascii");
console.log(`${result.pages} pages, ${result.pdf.length} bytes: ${output}`);
