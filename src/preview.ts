import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { transformBody } from "./export";
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

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  md: "markdown",
  sh: "bash",
  html: "xml",
};

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  highlight(code, language) {
    const name = ALIASES[language] ?? language;
    if (name && hljs.getLanguage(name)) {
      return hljs.highlight(code, { language: name }).value;
    }
    return "";
  },
});
md.use(footnote);

export type Rendered = {
  html: string;
  warnings: string[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function expandInlineNotes(body: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const lines = body.split("\n");
  const out: string[] = [];
  const notes: string[] = [];
  let fence: Fence | null = null;
  let count = 0;

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
    const spans = codeSpanRanges(line);
    out.push(
      line.replace(/\^\[([^\]]*)\]/g, (match, content: string, offset: number) => {
        if (insideSpan(offset, spans)) return match;
        count += 1;
        const label = `__inline_${count}`;
        notes.push(`[^${label}]: ${content}`);
        return `[^${label}]`;
      }),
    );
  }
  if (fence) warnings.push("Unclosed code fence.");
  let text = out.join("\n");
  if (notes.length) {
    if (!text.endsWith("\n")) text += "\n";
    text += "\n" + notes.join("\n") + "\n";
  }
  return { text, warnings };
}

function missingNotes(body: string): string[] {
  const defined = new Set<string>();
  const referenced: string[] = [];
  let fence: Fence | null = null;
  for (const line of body.split("\n")) {
    const mark = fenceMark(line);
    if (mark && !fence) {
      fence = { char: mark.char, len: mark.len };
      continue;
    }
    if (mark && fence && closesFence(fence, mark)) {
      fence = null;
      continue;
    }
    if (fence) continue;
    const spans = codeSpanRanges(line);
    const definition = /^\[\^([^\]]+)\]:/.exec(line);
    if (definition && !insideSpan(definition.index ?? 0, spans)) {
      defined.add(definition[1]);
      continue;
    }
    for (const match of line.matchAll(/\[\^([^\]]+)\]/g)) {
      if (!insideSpan(match.index ?? 0, spans)) referenced.push(match[1]);
    }
  }
  return referenced.filter((label) => !defined.has(label));
}

export function renderSection(node: TreeNode, ancestors: TreeNode[]): Rendered {
  const front = effectiveFront(
    node.header.role,
    ancestors.map((ancestor) => ancestor.header),
  );
  const depth = ancestors.length + 1;
  const warnings: string[] = [];
  const titleLevel = clampHeadingLevel(depth);
  if (depth > 6) warnings.push(`"${node.header.title}" is deeper than heading level 6.`);

  const shifted = transformBody(node.body, { depth, front: false });
  warnings.push(...shifted.warnings);
  const expanded = expandInlineNotes(shifted.text);
  warnings.push(...expanded.warnings.filter((warning) => !warnings.includes(warning)));

  const missing = missingNotes(node.body);
  for (const label of missing) warnings.push(`Footnote [^${label}] has no definition.`);

  let bodyHtml = md.render(expanded.text);
  if (missing.length) {
    const items = missing
      .map((label) => `<li class="missing-fn">Missing note [^${escapeHtml(label)}].</li>`)
      .join("");
    bodyHtml += `<ul class="missing-notes">${items}</ul>`;
  }
  if (warnings.some((warning) => warning.startsWith("Unclosed"))) {
    bodyHtml = `<p class="broken-fence">Unclosed code fence.</p>` + bodyHtml;
  }

  const title = escapeHtml(node.header.title);
  const klass = front ? "rendered-section front" : "rendered-section";
  const kicker = front ? `<p class="kicker">Front matter</p>` : "";
  const html = `<section class="${klass}" data-depth="${titleLevel.level}">${kicker}<h${titleLevel.level}>${title}</h${titleLevel.level}>${bodyHtml}</section>`;
  return { html, warnings };
}

export function renderGroup(node: TreeNode, ancestors: TreeNode[] = []): Rendered {
  const own = renderSection(node, ancestors);
  const warnings = [...own.warnings];
  const parts = [own.html];
  for (const child of node.children) {
    const rendered = child.kind === "group" ? renderGroup(child, [...ancestors, node]) : renderSection(child, [...ancestors, node]);
    parts.push(rendered.html);
    warnings.push(...rendered.warnings);
  }
  return { html: parts.join("\n"), warnings };
}
