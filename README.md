# Bookwriter

Bookwriter is a writing application for one long book. The book is a folder of Markdown files. You write each piece on its own, arrange the pieces in an outline, and export one manuscript or a PDF.

The rules of the manuscript live in `bookwriter-spec.md`. This file is how you run the program and how a book is laid out on disk.

## Usage

Clone the repository, install the dependencies, and link `bw` onto your `PATH`:

```
git clone git@github.com:unclebob/bookwriter.git
cd bookwriter
npm install
ln -s "$(pwd)/bw" ~/cmds/bw
```

`~/cmds` is one directory already on `PATH`. Any other directory on `PATH` works the same way. The link points at `bw` in the clone. The script resolves that link and uses the clone as its home.

The machine needs `zsh`, Node and npm, Rust (`cargo`), and the Xcode Command Line Tools.

Then:

```
Usage:
  bw <directory>
  bw --help

Build Bookwriter and open the book in <directory>.
The directory must already exist. A folder with no manuscript yet becomes an empty book.

bookwriter <directory> opens that book without rebuilding.
bookwriter --help prints this usage.
With no directory, bookwriter opens spec-book/.
```

`bw --help` and `bookwriter --help` print that usage and exit. `bw` with no directory, or with a path that is not a directory, prints the same usage and exits with status 64. `bw` opens the book from a Bookwriter app bundle, so the Dock and the app switcher show the book icon.

Inside the window:

- **File → Open Book** (⌘O) opens another folder. **Export Manuscript** (⌘⇧E) writes one Markdown file. **Export PDF** writes a PDF. The PDF prints the front matter's notes at the end of the front matter and each chapter's notes at the end of that chapter. **Export Chapters to Word** writes each front-matter piece as `FM-title.docx` and each chapter as `cc-title.docx` into one directory.
- The outline is the book. Drag a row to reorder it, or drop it on a folder to nest it. The form under the outline edits the title, synopsis, status, role, and unit. The book title is the field at the top of the window.
- A section opens in the Markdown editor. A folder opens as a reading view of that folder, in tree order.
- **Markup** shows or hides the preview beside the editor. The preview follows the buffer, including unsaved text. Clicking in the Markdown scrolls the preview to that place.
- **Find** (⌘F) searches the open text. The find panel has a whole-book checkbox. Find Next is ⌘G.
- **Command Palette** (⌘K) inserts emphasis, strong, inline code, a link, a picture, a heading, a list, a quotation, a code block, or a footnote. The Markup page lists the same commands.
- A footnote marker in the preview scrolls to that note, and the return mark scrolls back. When the Markdown is on screen, the cursor moves to that same place.

## A book on disk

```text
my-book/
  book.yaml
  images/
    bridge.jpg
  manuscript/
    010-front-matter/
      _index.md
      010-preface.md
    020-naming/
      _index.md
      010-the-rule/
        _index.md
        010-inward.md
    trash/
      _index.md
```

`book.yaml` holds the title.

```yaml
title: The Book Title
```

Under `manuscript/`:

- A directory is a folder of pieces. `_index.md` inside it is that folder's own prose. The body may be empty.
- Any other `.md` file is a section.
- `trash/` holds deleted pieces. Empty trash removes those pieces and leaves the folder. Export and the reading view skip it.
- Sibling order is the numeric prefix: `010`, `020`, `030`. The words after the prefix are a name taken from the title when the piece is created. Renaming the title does not rename the file. Dragging rewrites the prefixes in that directory.
- Pictures live in `images/`. A picture in the text is a path from the book folder, such as `images/bridge.jpg`.

Each Markdown file starts with a header the application owns. The body after the header is yours, and it is written back as the editor holds it.

```markdown
---
id: inward
title: Inward
synopsis: Source dependencies point inward, toward policy.
status: draft
role: body
unit: text
---
A dependency points inward.[^1]

# Where the rule stops

[^1]: Toward higher-level policy.
```

`id` stays put for the life of the piece. `status` is `idea`, `draft`, `revise`, or `done`. `role` is `front` or `body`. Front matter is not numbered. `unit` is `part`, `chapter`, `section`, or `text`. A part or a chapter is numbered, and a part, a chapter, or a section starts on a new page. Text stays on the current page. The numbers are computed from the tree. They are not stored in the file.

The body is Pandoc Markdown. A heading in the body is a subsection, written with `#`. A footnote is `[^1]` with `[^1]: …` in the same file, or an inline `^[…]`. Labels are local to that file.

## Source

| Path | What it is |
|---|---|
| `bw` | Builds the app and opens a book |
| `usage.txt` | The text `--help` prints |
| `bookwriter-spec.md` | Living spec |
| `spec-book/` | The book opened when `bookwriter` is started with no directory |
| `index.html`, `src/main/styles.css` | The window |
| `src/main/main.ts` | Outline, editor, menus, preview scroll |
| `src/internals/model.ts` | Headers, units, part and chapter numbers |
| `src/internals/book.ts` | Load, save, create, delete, and reorder the tree |
| `src/ui/commands.ts` | The twelve markup commands |
| `src/ui/preview.ts` | Preview and reading view |
| `src/export/export.ts` | Manuscript Markdown |
| `src/export/pdf.ts`, `src/export/pdfimage.ts` | PDF |
| `src/ui/find.ts` | Whole-book find |
| `src/internals/pictures.ts` | Pictures under `images/` |
| `src-tauri/src/lib.rs` | Reads and writes the book folder |

Tests are the `*.test.ts` files next to the source, and the tests at the bottom of `src-tauri/src/lib.rs`.

```
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## Japanese PDF export

PDF export includes M PLUS 1p regular and bold fonts for Japanese headings,
body text, captions, notes, and code. The fonts are bundled for offline use;
only glyphs used by a document are embedded. Japanese text remains selectable
and extractable through PDF Unicode maps. Existing Helvetica/Courier Latin
text is retained, and Latin-only PDFs do not embed the Japanese fonts.

Japanese and mixed Latin text wrap by measured glyph widths, with basic
Japanese punctuation rules. Code keeps its spaces and tab stops, uses two
Latin columns for fullwidth Japanese characters, and wraps within its shaded
box across pages. Kana with decomposed dakuten/handakuten is normalized to NFC.
Japanese emphasis uses upright regular/bold faces; Latin italics are unchanged.

Coverage is limited to the bundled fonts (8,331 mapped code points per face).
Rare kanji, supplementary ideographs, emoji, and variation sequences are not
fully supported; missing glyphs appear as explicit `[U+XXXX]` markers and are
listed in export warnings. This is horizontal Japanese manuscript output, not
complete Japanese typesetting: vertical text, ruby, full JIS line-breaking,
and shaping for other writing systems are not implemented. Text extraction
may add spaces/newlines around mixed fonts and line/page breaks.

The export chunk is loaded on demand and adds about 5.1 MB to the packaged
frontend (about 2.65 MB gzip). A four-page sample with both font styles is about
81 KB. Font sources, reproducible encoding, checksums, and a link to the bundled license are in
[`src/export/fonts/`](src/export/fonts/README.md).

Generate the self-authored, shareable regression sample without launching Tauri:

```sh
npx tsx scripts/japanese-pdf-sample.ts /tmp/bookwriter-japanese.pdf
python3 scripts/verify-japanese-pdf.py /tmp/bookwriter-japanese.pdf
pdftoppm -png /tmp/bookwriter-japanese.pdf /tmp/bookwriter-japanese
```

The verification script requires Poppler (`pdftotext`, `pdfinfo`, `pdffonts`).
It checks Japanese extraction, every numbered code row, complete long passages,
font embedding, Unicode metadata, and text bounds on all four pages. Inspect
all rendered PNGs as well. `npm test` runs the portable export regressions.
