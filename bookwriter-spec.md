# Bookwriter

Living spec. This is a draft. Expect it to change.

Bookwriter is a small writing application for one long book. A book is an ordered tree of short documents. You write each document on its own, rearrange the tree by dragging, and export one manuscript.

## The book

There are two kinds of node.

- A **group** holds other nodes, and it may hold prose of its own. A part is a group. A chapter is a group inside a part.
- A **section** is a leaf. It holds prose.

The application has no Part type, Chapter type, or Section type. Those are positions in the tree. A short book can be a flat list of sections. A long book can nest as deep as it needs.

A **subsection** is not a node. It is a Markdown heading inside a section.

**Front matter** (copyright, dedication, preface) is ordinary nodes with role `front`. The tree controls where they sit. The role controls how export numbers them.

Each node has:

| Field | Meaning |
|---|---|
| `id` | Stable identity. Assigned when the node is created. Never changed by a rename or a reorder. Unique within the book. |
| `title` | The heading export will emit for this node. |
| `synopsis` | Short summary shown under the title in the outline. May be empty. |
| `status` | One of `idea`, `draft`, `revise`, `done`. A new node starts as `idea`. |
| `role` | One of `front` or `body`. A new node starts as `body`. |

A node is front matter when its own role is `front`, or when any group above it is `front`. Set the role on the front-matter group and the children follow.

Word count is computed, never stored. A section's count is the number of whitespace-separated words in its body. A group's count is the words in its own body plus the counts of its children.

## On disk

The book is a folder of Pandoc Markdown files. The folder is the only stored form of the book. There is no database and no separate binder file.

```text
my-book/
  book.yaml
  manuscript/
    010-front-matter/
      _index.md
      010-preface.md
    020-naming/
      _index.md
      010-the-rule/
        _index.md
        010-inward.md
        020-boundaries.md
```

`book.yaml` holds facts about the whole book. Today that is the title.

```yaml
title: The Book Title
```

Under `manuscript/`:

- A directory is a group.
- `_index.md` inside a directory is that group's own document. Every group has one. The body may be empty.
- Any other `.md` file is a section.
- `_index.md` is reserved. A section cannot use that name.

Order among siblings is a numeric prefix: `010`, `020`, `030`, step 10, at least three digits. The slug after the prefix is a readable name taken from the title when the node is created. Changing the title does not rename the file. Reordering rewrites the prefixes of the siblings in that directory and leaves every other directory alone. The `id` does not change.

The slug is lowercase words separated by hyphens, with punctuation removed. The `id` is that same slug. If the id is already used in the book, the application appends `-2`, `-3`, and so on.

If a directory would need a prefix past `990`, the prefixes in that directory gain another digit (`0100`, `0200`, …).

Files are UTF-8 with LF line endings.

## A section file

The application owns the header. The writer owns the body. The header is rewritten in a fixed field order on every save. The body is written back as the editor holds it. The application does not parse the body and serialize it again, and it does not reflow it.

````markdown
---
id: inward
title: Inward
synopsis: Source dependencies point inward, toward policy.
status: draft
role: body
---
A dependency points inward.[^1]

# Where the rule stops

```java
class Foo {
    void bar() {}
}
```

[^1]: Toward higher-level policy.
````

The header is the first thing in the file. One newline separates the closing `---` from the body. An empty body ends the file after that newline.

The body is Pandoc Markdown.

- The title lives in the header. The body does not repeat it.
- A heading in the body is a subsection or deeper. Write `#` for a subsection. Write `##` for the level under that. Export shifts these headings by the node's depth.
- A code snippet is a fenced block with a language tag, with a blank line before and after the fence.
- A footnote is Pandoc syntax. `[^1]` refers to a definition `[^1]: …` in the same file. An inline note `^[Toward higher-level policy.]` is also allowed. Labels in the file are local to that file. Two sections may both use `[^1]`.

A group's `_index.md` uses the same header and the same body rules.

## Outline

The outline is the home screen. It shows the tree. Each row shows the title, the status, the word count, and the synopsis.

Dragging a row changes the order. Dropping a row onto a group makes it a child of that group. Both operations are prefix rewrites, as described above.

There is no corkboard and no index-card view.

## Editor

Selecting a section opens its body in the editor. The header is edited from the outline, not from inside the body.

The editor shows Markdown source. The characters in the editor are the characters in the file. A subsection is a line that starts with `#`. A code snippet is a fenced block. A footnote is `[^1]` or an inline `^[…]`. Saving writes that buffer to the body and leaves every other byte of the body as the writer left it.

The marks stay visible. Highlighting shows a heading line as a heading and a fenced block as code, with the `#` and the backticks still on screen.

## Preview

The open section has a rendered preview beside the Markdown. It can be shown or hidden.

The preview is drawn from the editor buffer as the buffer changes, including text that has not been saved. It shows that section as export will show it. The title is a heading at the section's depth. Body headings are shifted by that same depth. A front-matter section shows its headings unnumbered. Code is highlighted. Footnotes are shown as notes, numbered in the order they appear in the section. A broken fence or a footnote reference with no definition is visible in the preview.

Typing stays in the Markdown editor. The preview is a view of the buffer.

## Markup commands

A command inserts the characters for one construct. The writer recalls the name. The command recalls the syntax. The command writes into the buffer at the cursor and does not rebuild the section. Existing text is left as it stands, including existing footnote numbers.

The menu and the command palette list these eleven commands. The palette finds a command by its name, so "foot" reaches Footnote.

| Command | What it inserts |
|---|---|
| Emphasis | `*…*` around the selection |
| Strong | `**…**` around the selection |
| Inline code | `` `…` `` around the selection |
| Link | `[selection](url)` |
| Subsection | `# ` at the start of the current line |
| Lower subsection | `## ` at the start of the current line |
| Bullet list | `- ` at the start of the current line |
| Numbered list | `1. ` at the start of the current line |
| Quotation | `> ` at the start of the current line |
| Code block | A fenced block around the selection, with a blank line before and after |
| Footnote | `[^n]` at the cursor, and a matching definition at the end of the section |

With a selection, Emphasis, Strong, Inline code, and Link wrap it and leave the cursor after the closing mark. With nothing selected, they insert the marks and leave the cursor between them.

Code block takes its language tag from the most recent fenced block already in the book. The cursor is left inside the block. When the book has no fenced block yet, the tag is empty and the cursor is left on the tag so it can be filled in.

Footnote scans the open section for `[^n]` definitions and uses the next free number. The cursor is left after `[^n]: `, ready for the note. Definitions already in the file keep their numbers.

One reminder page lists these same eleven commands and the characters each one inserts. The page and the menu match.

Any other Pandoc construct can still be typed by hand. The menu, the palette, and the reminder page cover this list only.

## Reading

Selecting a group opens a rendered view of that group, in tree order: the group's own body, then each descendant's title and body. Headings are shown at their exported size, code is highlighted, and footnotes are shown as notes. This is how a chapter is read straight through.

The rendered view is produced from the files for reading. It is not edited. To change a sentence, open the section that contains it. The section preview, beside the editor, is the rendered view of the one section being written.

## Export

Export walks the tree in order and writes one Pandoc Markdown file. That file is the manuscript. It is written outside `manuscript/`. The writer chooses the destination when exporting.

For each node, export emits the title as a heading, then the body.

The heading level is the node's depth. Depth is the number of groups under `manuscript/` that contain the node, counting the node's own group when the node is a group's `_index.md`.

| Node | Depth | Exported heading |
|---|---|---|
| `manuscript/020-naming/_index.md` | 1 | `# Naming` |
| `manuscript/020-naming/010-the-rule/_index.md` | 2 | `## The Rule` |
| `manuscript/020-naming/010-the-rule/010-inward.md` | 3 | `### Inward` |

A body heading is shifted by that same depth. A `#` inside `010-inward.md` is exported as `####`, one level below the section's own heading. Markdown has six heading levels. A heading that would land past level 6 is exported at level 6, and the export warns.

A front-matter heading is emitted with Pandoc's unnumbered marker: `# Preface {-}`. Body headings inside front matter get the same marker.

Footnote labels are prefixed with the section id during export, on both the reference and the definition. `[^1]` in the section whose id is `inward` is written as `[^inward-1]`. Inline notes have no label and need no prefix. Pandoc numbers the notes in the finished book. The labels in the source are not the numbers a reader sees.

Export of the example above:

````markdown
# Preface {-}

The preface body.

# Naming

The part opener.

## The Rule

The chapter opener.

### Inward

A dependency points inward.[^inward-1]

#### Where the rule stops

```java
class Foo {
    void bar() {}
}
```

[^inward-1]: Toward higher-level policy.
````

The application stops at that Markdown file. PDF, EPUB, and Word are Pandoc's job, run on the exported file. Bookwriter does not grow a compile engine of its own.

## Application

The program is written in TypeScript.

The window is a Tauri window: a dock icon, a menu bar, and direct access to the book folder.

The body editor is CodeMirror. It edits the Markdown body, and the buffer is the file. The section preview is drawn from that buffer. The rendered chapter view is the reading view of a group.

The local program does five things with the folder:

- list a directory
- read a file
- write a file
- rename siblings when the order changes
- concatenate the tree for export

## Left out

Recorded so this spec does not quietly grow back into Scrivener.

- Corkboard, index cards, and a second layout of the same tree
- A rendered editor that writes Markdown back out on save
- Commands that rebuild a section, including renumbering footnotes already in the file
- A menu or reminder for Pandoc constructs beyond the eleven markup commands
- Compile presets, section types, separators, and placeholders
- Custom metadata fields beyond the five in the header
- A research bin of PDFs and clippings
- Snapshots as an application feature
- A database, or any copy of the book that can drift from the files
- An index, numbered references such as "see Figure 3," and callout numbers on lines of code

A book that must carry an index, numbered references, or code callouts in the source can store AsciiDoc bodies in this same tree. That is not part of the current design.

## Open questions

- Back matter (appendices, glossary) as a third role beside `front` and `body`.
