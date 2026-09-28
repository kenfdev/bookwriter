import { assignPrefixes, serializeSection, serializeTitle, uniqueId, type Header, type Role } from "./model";
import { joinPath } from "./path";
import type { Fs } from "./book";
import { fenceMark, type Fence } from "./model";

export type SpecSection = { title: string; body: string };

export type SplitSpec = {
  title: string;
  intro: string;
  sections: SpecSection[];
};

function trimBlank(text: string): string {
  const lines = text.split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/**
 * Split the living spec on top-level `##` headings.
 * Fences stack, so an example that itself contains a fenced block stays one section.
 * Manuscript export does not stack fences; Pandoc closes the outer fence at the first closer.
 */
export function splitSpec(markdown: string): SplitSpec {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const chunks: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
  const fences: Fence[] = [];
  let title = "";

  for (const line of lines) {
    const inFence = fences.length > 0;
    if (!inFence && !title && /^# /.test(line)) {
      title = line.slice(2).trim();
      continue;
    }
    if (!inFence && /^## /.test(line)) {
      chunks.push({ title: line.slice(3).trim(), lines: [] });
      continue;
    }
    chunks[chunks.length - 1].lines.push(line);
    const mark = fenceMark(line);
    if (!mark) continue;
    if (mark.info.trim() !== "") fences.push({ char: mark.char, len: mark.len });
    else if (fences.length) fences.pop();
    else fences.push({ char: mark.char, len: mark.len });
  }

  return {
    title: title || "Book",
    intro: trimBlank(chunks[0].lines.join("\n")),
    sections: chunks.slice(1).map((chunk) => ({
      title: chunk.title,
      body: trimBlank(chunk.lines.join("\n")),
    })),
  };
}

function withNewline(body: string): string {
  if (!body) return "";
  return body.endsWith("\n") ? body : body + "\n";
}

export async function writeSpecBook(fs: Fs, root: string, markdown: string): Promise<void> {
  const spec = splitSpec(markdown);
  const groupDir = joinPath(root, "manuscript", "010-bookwriter");
  await fs.mkdir(groupDir);
  await fs.writeText(joinPath(root, "book.yaml"), serializeTitle(spec.title));
  const group: Header = {
    id: "bookwriter",
    title: spec.title,
    synopsis: "The living specification.",
    status: "draft",
    role: "body" satisfies Role,
  };
  await fs.writeText(joinPath(groupDir, "_index.md"), serializeSection(group, withNewline(spec.intro)));

  const used = new Set<string>(["bookwriter"]);
  const prefixes = assignPrefixes(spec.sections.length);
  for (let i = 0; i < spec.sections.length; i += 1) {
    const section = spec.sections[i];
    const id = uniqueId(section.title, used);
    used.add(id);
    const header: Header = {
      id,
      title: section.title,
      synopsis: "",
      status: "draft",
      role: "body",
    };
    const name = `${prefixes[i]}-${id}.md`;
    await fs.writeText(joinPath(groupDir, name), serializeSection(header, withNewline(section.body)));
  }
}
