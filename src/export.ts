import {
  clampHeadingLevel,
  closesFence,
  codeSpanRanges,
  effectiveFront,
  fenceMark,
  insideSpan,
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

/**
 * Shift body headings by the section depth and, when asked, prefix footnote labels.
 * Fenced code is copied through unchanged.
 */
export function transformBody(body: string, options: TransformOptions): Transformed {
  const warnings: string[] = [];
  const lines = body.split("\n");
  const out: string[] = [];
  let fence: Fence | null = null;

  for (const line of lines) {
    const mark = fenceMark(line);
    if (mark && !fence) {
      fence = { char: mark.char, len: mark.len };
      out.push(line);
      continue;
    }
    if (mark && fence && closesFence(fence, mark)) {
      fence = null;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }

    const heading = /^(#{1,6})([ \t]+)(.*)$/.exec(line);
    if (heading) {
      const raw = heading[1].length + options.depth;
      const clamped = clampHeadingLevel(raw);
      if (clamped.clamped) {
        warnings.push(`A heading of level ${raw} was written at level ${clamped.level}.`);
      }
      let text = heading[3];
      if (options.front && !/\{\s*-\s*\}/.test(text)) {
        text = `${text} {-}`.trimStart();
        if (heading[3].length === 0) text = "{-}";
      }
      out.push("#".repeat(clamped.level) + heading[2] + text);
      continue;
    }

    out.push(options.sectionId ? prefixFootnotes(line, options.sectionId) : line);
  }

  if (fence) warnings.push("Unclosed code fence.");
  return { text: out.join("\n"), warnings };
}

function titleHeading(depth: number, title: string, front: boolean, warnings: string[]): string {
  const clamped = clampHeadingLevel(depth);
  if (clamped.clamped && depth > 6) {
    warnings.push(`"${title}" is deeper than heading level 6 and was written at level 6.`);
  }
  const marker = front ? " {-}" : "";
  return `${"#".repeat(clamped.level)} ${title}${marker}`;
}

function exportNode(node: TreeNode, ancestors: TreeNode[], warnings: string[]): string {
  const front = effectiveFront(
    node.header.role,
    ancestors.map((ancestor) => ancestor.header),
  );
  const depth = ancestors.length + 1;
  const heading = titleHeading(depth, node.header.title, front, warnings);
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
    parts.push(exportNode(child, [...ancestors, node], warnings));
  }
  return parts.join("\n\n");
}

export function exportBook(nodes: TreeNode[]): { markdown: string; warnings: string[] } {
  const warnings: string[] = [];
  const markdown = nodes
    .filter((node) => node.header.id !== "trash")
    .map((node) => exportNode(node, [], warnings))
    .join("\n\n");
  return { markdown, warnings };
}
