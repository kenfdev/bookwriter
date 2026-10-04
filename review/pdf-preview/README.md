# macOS Preview font comparison

These one-page PDFs contain only self-authored test text and generated colored
rectangles. They contain no textbook or user manuscript content.

- [before.pdf](before.pdf): current fontkit subsets, exported by main at
  `47527edff6e22a6058aa51679620ffad147a314e` (17,965 bytes).
- [after.pdf](after.pdf): intact bundled fonts, exported by candidate
  `bc434da2e2a93bb51439e9f82f8d7cfe1e1da897` (4,456,321 bytes).

Download both files and open them in **macOS Preview**. Check the Japanese
heading, bold text, captions, body before/after the two pictures, and code.
Record which file displays Japanese and the macOS version. Seeing text in
GitHub, Slack, or another viewer does not establish Preview compatibility.

The candidate has passed automated font-structure checks, Japanese extraction,
and Linux rendering checks. **Preview verification is still pending.**
The comparison files are retained unchanged so the review is reproducible.
Generate the candidate fixture with:

```sh
npx tsx scripts/preview-pdf-sample.ts /tmp/bookwriter-preview-sample.pdf
```

Both files embed M PLUS 1p fonts, licensed under the
[SIL Open Font License 1.1](../../public/licenses/MPLUS1p-OFL.txt).
See [font provenance](../../src/export/fonts/README.md).

SHA-256:

```text
8f0ef4f4cd845ab1faeba9dd990bc1e2d33b682fa23079b7e0176f3d14a2b4e4  before.pdf
50171ed923c5fe2aa7951c59b5c82ac3f9e0f37e83b0409ffc6a99f8cb513185  after.pdf
```

## Cap-height-only diagnostic

The user reported that `after.pdf` still appears blank in macOS Preview.
The full-font change therefore did not resolve the reported failure.
Both original PDFs contain the invalid numeric token `/CapHeight NaN` because
these OS/2 version 1 fonts omit the cap-height metric.

[cap-height-only.pdf](cap-height-only.pdf) is a controlled test based on
`before.pdf`: exactly six bytes change, replacing the two occurrences of
`/CapHeight NaN` with `/CapHeight 730`. Both files remain 17,965 bytes. The
original subset fonts, mappings, pictures, layout, and cross-reference offsets
are unchanged. Local extracted text and MuPDF-rendered pixels are identical.

Open this small diagnostic in macOS Preview and compare it with `before.pdf`.
**Preview verification is pending.** This diagnostic deliberately retains the
old subset embedding to isolate the numeric correction; current application
exports retain the full fonts introduced in PR #2.

The value 730 comes from the unscaled capital-H glyph bounds of both fonts
(1000 units per em). This is the fallback described by the
[OpenType sCapHeight specification](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#scapheight).

```text
4700cabbdb6067bbcdc2885be226d0db09f4c93a769e3afe418c485fc60bc00f  cap-height-only.pdf
```
