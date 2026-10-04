"""Independent PDF integration check. Requires Poppler's pdftotext/pdfinfo/pdffonts.
Run after: npx tsx scripts/japanese-pdf-sample.ts /tmp/japanese.pdf
Usage: python3 scripts/verify-japanese-pdf.py /tmp/japanese.pdf
"""
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

pdf = sys.argv[1]
text = subprocess.check_output(["pdftotext", "-layout", pdf, "-"], text=True)
without_footers = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)
compact = re.sub(r"\s", "", without_footers)
for phrase in ["日本語の本", "太字の日本語", "Englishwords", "ＡＢＣ１２３", "ｶﾀｶﾅ", "が、ぱ", "日本語の脚注です。", "本文とコードの終わりです。"]:
    assert phrase in compact, f"Missing extracted text: {phrase}"
for n in range(1, 66):
    assert compact.count(f"const記録{n:02d}=") == 1, f"Lost or duplicated code row {n}"
paragraph = "日本語の長い文章を、空白がなくても文字の幅に合わせて折り返します。「ページの境界でも文章を失わない」という確認を繰り返し、最後まで読み続けます。"
assert paragraph * 30 in compact, "Long body lost, duplicated, or reordered text at a line/page break"
assert "長いコード行の日本語" * 20 in compact.replace("»", ""), "Long code lost text at a wrap"
assert "?" not in text and "\ufffd" not in text, "Unexpected replacement characters"
info = subprocess.check_output(["pdfinfo", pdf], text=True)
assert "日本語の本 — Bookwriter" in info, "Unicode metadata did not round-trip"
fonts = subprocess.check_output(["pdffonts", pdf], text=True)
for name in ["MPLUS1p-Regular", "MPLUS1p-Bold"]:
    line = next(line for line in fonts.splitlines() if name in line)
    assert re.search(r"yes\s+no\s+yes", line), "Japanese font must be embedded intact and Unicode mapped"
xml = subprocess.check_output(["pdftotext", "-bbox", pdf, "-"])
root = ET.fromstring(xml)
ns = {"pdf": "http://www.w3.org/1999/xhtml"}
pages = root.findall(".//pdf:page", ns)
assert len(pages) == 4, f"Unexpected pagination: {len(pages)} pages"
for number, page in enumerate(pages, 1):
    for word in page.findall(".//pdf:word", ns):
        x0, y0, x1, y1 = [float(word.attrib[k]) for k in ["xMin", "yMin", "xMax", "yMax"]]
        assert 71 <= x0 <= x1 <= 541, (number, word.text, "horizontal overflow", x0, x1)
        if word.text == str(number) and y0 > 730:
            continue
        assert 60 <= y0 <= y1 <= 721, (number, word.text, "vertical overflow", y0, y1)
print(f"PASS: {len(pages)} pages; Japanese text, all 65 code rows, long body/code, Unicode title, embedded fonts, and text bounds")
