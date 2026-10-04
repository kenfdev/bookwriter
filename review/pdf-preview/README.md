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
