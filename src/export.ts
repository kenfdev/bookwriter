import {
  clampHeadingLevel,
  closesFence,
  codeSpanRanges,
  divisionLabel,
  divisions,
  effectiveFront,
  fenceMark,
  insideSpan,
  startsNewPage,
  type Division,
  type Fence,
  type TreeNode,
} from "./model";

export type TransformOptions = {
  depth: number;
  /** When set, footnote labels are prefixed with this section id. */
  sectionId?: string;
  /** Front matter headings gain Pandoc's unnumbered marker. */
  front?: boolean;
};

export type Transformed = {
  text: string;
  warnings: string[];
};

function prefixFootnotes(line: string, sectionId: string): string {
  const spans = codeSpanRanges(line);
  return line.replace(/\[\^([^\]]+)\]/g, (match, label: string, offset: number) => {
    if (insideSpan(offset, spans)) return match;
    return `[^${sectionId}-${label}]`;
  });
}

type FenceStep = { fence: Fence | null; copy: boolean };

function stepFence(line: string, fence: Fence | null): FenceStep {
  const mark = fenceMark(line);
  if (!mark) return { fence, copy: fence !== null };
  if (!fence) return { fence: { char: mark.char, len: mark.len }, copy: true };
  if (closesFence(fence, mark)) return { fence: null, copy: true };
  return { fence, copy: true };
}

function unnumbered(text: string): string {
  if (/\{\s*-\s*\}/.test(text)) return text;
  if (text.length === 0) return "{-}";
  return `${text} {-}`.trimStart();
}

function shiftHeading(line: string, options: TransformOptions, warnings: string[]): string | null {
  const heading = /^(#{1,6})([ \t]+)(.*)$/.exec(line);
  if (!heading) return null;
  const raw = heading[1].length + options.depth;
  const clamped = clampHeadingLevel(raw);
  if (clamped.clamped) warnings.push(`A heading of level ${raw} was written at level ${clamped.level}.`);
  let text = heading[3];
  if (options.sectionId) text = prefixFootnotes(text, options.sectionId);
  if (options.front) text = unnumbered(text);
  return "#".repeat(clamped.level) + heading[2] + text;
}

function proseLine(line: string, options: TransformOptions): string {
  if (!options.sectionId) return line;
  return prefixFootnotes(line, options.sectionId);
}

/**
 * Shift body headings by the section depth and, when asked, prefix footnote labels.
 * Fenced code is copied through unchanged.
 */
export function transformBody(body: string, options: TransformOptions): Transformed {
  const warnings: string[] = [];
  const out: string[] = [];
  let fence: Fence | null = null;

  for (const line of body.split("\n")) {
    const stepped = stepFence(line, fence);
    fence = stepped.fence;
    if (stepped.copy) {
      out.push(line);
      continue;
    }
    out.push(shiftHeading(line, options, warnings) ?? proseLine(line, options));
  }

  if (fence) warnings.push("Unclosed code fence.");
  return { text: out.join("\n"), warnings };
}

/** Class on the centered "Part N" or "Chapter N" line. The reading view and the PDF both recognize it. */
export const CHAPTER_NUMBER_CLASS = "chapter-number";

/** Class on the break that starts a node on a new page. */
export const PAGE_BREAK_CLASS = "page-break";

export function divisionOpener(division: Division): string {
  return `<p class="${CHAPTER_NUMBER_CLASS}">${divisionLabel(division)}</p>`;
}

export function pageBreak(): string {
  return `<div class="${PAGE_BREAK_CLASS}"></div>`;
}

function titleHeading(
  depth: number,
  title: string,
  front: boolean,
  warnings: string[],
  division?: Division,
): string {
  const clamped = clampHeadingLevel(depth);
  if (clamped.clamped && depth > 6) {
    warnings.push(`"${title}" is deeper than heading level 6 and was written at level 6.`);
  }
  const marker = front ? " {-}" : "";
  const heading = `${"#".repeat(clamped.level)} ${title}${marker}`;
  if (!division) return heading;
  return `${divisionOpener(division)}\n\n${heading}`;
}

function exportNode(
  node: TreeNode,
  ancestors: TreeNode[],
  warnings: string[],
  numbered: Map<string, Division>,
  followed: boolean,
): string {
  const front = effectiveFront(
    node.header.role,
    ancestors.map((ancestor) => ancestor.header),
  );
  const depth = ancestors.length + 1;
  const heading = titleHeading(depth, node.header.title, front, warnings, numbered.get(node.header.id));
  const transformed = transformBody(node.body, {
    depth,
    sectionId: node.header.id,
    front,
  });
  warnings.push(...transformed.warnings);
  const body = transformed.text.replace(/\n+$/, "");
  const own = body.length > 0 ? `${heading}\n\n${body}` : heading;
  const parts = [own];
  for (const child of node.children) {
    parts.push(exportNode(child, [...ancestors, node], warnings, numbered, true));
  }
  const text = parts.join("\n\n");
  if (startsNewPage(node) && followed) return `${pageBreak()}\n\n${text}`;
  return text;
}

export function exportBook(nodes: TreeNode[]): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];
  const numbered = divisions(nodes);
  const markdown = nodes
    .filter((node) => node.header.id !== "trash")
    .map((node, index) => exportNode(node, [], warnings, numbered, index > 0))
    .join("\n\n");
  return { markdown, warnings };
}
