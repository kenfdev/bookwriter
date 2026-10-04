import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { markdownToPdf } from "../src/export/pdf";

const output = resolve(process.argv[2] ?? "output/pdf/bookwriter-japanese-sample.pdf");
const fixture = readFileSync(new URL("../src/export/fixtures/japanese.md", import.meta.url), "utf8");
const paragraph = "日本語の長い文章を、空白がなくても文字の幅に合わせて折り返します。「ページの境界でも文章を失わない」という確認を繰り返し、最後まで読み続けます。";
const code = Array.from({ length: 65 }, (_, i) => `const 記録${String(i + 1).padStart(2, "0")} = "日本語と English のコードを確認します。";`).join("\n");
const source = `${fixture}\n\n## 長文の折り返しと改ページ\n\n${paragraph.repeat(30)}\n\n## ページをまたぐコード\n\n\`\`\`ts\n${code}\n${"長いコード行の日本語".repeat(20)}\n\`\`\`\n\n## 最後の確認\n\n本文とコードの終わりです。`;
const result = markdownToPdf(source, "日本語の本 — Bookwriter");
if (result.warnings.length) throw new Error(result.warnings.join("\n"));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, result.pdf, "ascii");
console.log(`${result.pages} pages, ${result.pdf.length} bytes: ${output}`);
