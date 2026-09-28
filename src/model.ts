export const STATUSES = ["idea", "draft", "revise", "done"] as const;
export type Status = (typeof STATUSES)[number];
export type Role = "front" | "body";

export type Header = {
  id: string;
  title: string;
  synopsis: string;
  status: Status;
  role: Role;
};

export type TreeNode = {
  kind: "group" | "section";
  header: Header;
  body: string;
  prefix: string;
  slug: string;
  /** Directory that contains this node's entry. */
  dir: string;
  /** File or directory name inside `dir`, including the numeric prefix. */
  entryName: string;
  children: TreeNode[];
};

export type ParsedSection = {
  header: Header;
  body: string;
  warnings: string[];
};

const HEADER_KEYS = ["id", "title", "synopsis", "status", "role"] as const;

export function wordCount(body: string): number {
  const trimmed = body.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function nodeWordCount(node: TreeNode): number {
  return (
    wordCount(node.body) +
    node.children.reduce((sum, child) => sum + nodeWordCount(child), 0)
  );
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function uniqueId(title: string, used: Set<string>): string {
  const base = slugify(title);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Sibling prefixes step by 10 and use at least three digits.
 * Past 990 the width grows so the last prefix still fits, and the step stays 10.
 */
export function assignPrefixes(count: number): string[] {
  if (count <= 0) return [];
  const step = 10;
  let width = 3;
  while (count * step >= 10 ** width) width += 1;
  const prefixes: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    prefixes.push(String(i * step).padStart(width, "0"));
  }
  return prefixes;
}

export function nextPrefix(existing: string[]): string {
  const nums = existing.map((prefix) => Number.parseInt(prefix, 10)).filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  const n = max + 10;
  const width = Math.max(3, String(n).length);
  return String(n).padStart(width, "0");
}

export function effectiveFront(role: Role, ancestors: { role: Role }[]): boolean {
  return role === "front" || ancestors.some((ancestor) => ancestor.role === "front");
}

export function clampHeadingLevel(level: number): { level: number; clamped: boolean } {
  if (level > 6) return { level: 6, clamped: true };
  if (level < 1) return { level: 1, clamped: true };
  return { level, clamped: false };
}

export function quoteScalar(value: string): string {
  if (value === "") return '""';
  const plain = /^[A-Za-z0-9][A-Za-z0-9 .,'_-]*$/.test(value);
  const reserved = /^(true|false|null|yes|no|on|off)$/i.test(value);
  if (plain && !reserved) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function parseScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    let out = "";
    for (let i = 1; i < value.length; i += 1) {
      const char = value[i];
      if (char === "\\") {
        i += 1;
        const escaped = value[i] ?? "";
        out += escaped === "n" ? "\n" : escaped;
        continue;
      }
      if (char === '"') break;
      out += char;
    }
    return out;
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function defaultHeader(partial: Partial<Header>): Header {
  return {
    id: partial.id || "section",
    title: partial.title ?? "",
    synopsis: partial.synopsis ?? "",
    status: partial.status ?? "idea",
    role: partial.role ?? "body",
  };
}

export function serializeSection(header: Header, body: string): string {
  const yaml = [
    "---",
    `id: ${quoteScalar(header.id)}`,
    `title: ${quoteScalar(header.title)}`,
    `synopsis: ${quoteScalar(header.synopsis)}`,
    `status: ${header.status}`,
    `role: ${header.role}`,
    "---",
    "",
  ].join("\n");
  return yaml + body;
}

export function parseSection(text: string): ParsedSection {
  const warnings: string[] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const matched = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!matched) {
    warnings.push("Missing header. The file was read as a body.");
    return { header: defaultHeader({ title: "Untitled" }), body: normalized, warnings };
  }
  const fields = new Map<string, string>();
  for (const line of matched[1].split("\n")) {
    if (!line.trim()) continue;
    const split = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!split) {
      warnings.push(`Ignored header line "${line}".`);
      continue;
    }
    fields.set(split[1], parseScalar(split[2]));
  }
  for (const key of HEADER_KEYS) {
    if (!fields.has(key)) warnings.push(`Header is missing ${key}.`);
  }
  let status = (fields.get("status") ?? "idea") as Status;
  if (!STATUSES.includes(status)) {
    warnings.push(`Status "${status}" is not one of ${STATUSES.join(", ")}.`);
    status = "idea";
  }
  let role = (fields.get("role") ?? "body") as Role;
  if (role !== "front" && role !== "body") {
    warnings.push(`Role "${role}" is not front or body.`);
    role = "body";
  }
  return {
    header: {
      id: fields.get("id") || "section",
      title: fields.get("title") ?? "",
      synopsis: fields.get("synopsis") ?? "",
      status,
      role,
    },
    body: matched[2],
    warnings,
  };
}

export function serializeTitle(title: string): string {
  return `title: ${quoteScalar(title)}\n`;
}

export function parseTitle(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  for (const line of normalized.split("\n")) {
    const matched = /^title:\s*(.*)$/.exec(line);
    if (matched) return parseScalar(matched[1]);
  }
  return "";
}

export type Fence = { char: string; len: number };

/** A fence opener or closer, using CommonMark's rule that a closer carries no info string. */
export function fenceMark(line: string): { char: string; len: number; info: string } | null {
  const matched = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!matched) return null;
  const token = matched[2];
  const info = matched[3];
  if (token.startsWith("`") && info.includes("`")) return null;
  return { char: token[0], len: token.length, info };
}

export function closesFence(open: Fence, mark: { char: string; len: number; info: string }): boolean {
  return mark.char === open.char && mark.len >= open.len && mark.info.trim() === "";
}

/** Closed inline code spans on one line. An unmatched backtick is ordinary text. */
export function codeSpanRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    let ticks = 0;
    while (line[index + ticks] === "`") ticks += 1;
    const closer = line.indexOf("`".repeat(ticks), index + ticks);
    if (closer < 0) break;
    ranges.push([index, closer + ticks]);
    index = closer + ticks;
  }
  return ranges;
}

export function insideSpan(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

export function walk(nodes: TreeNode[], visit: (node: TreeNode, ancestors: TreeNode[]) => void, ancestors: TreeNode[] = []): void {
  for (const node of nodes) {
    visit(node, ancestors);
    walk(node.children, visit, [...ancestors, node]);
  }
}

export function findNode(nodes: TreeNode[], id: string): { node: TreeNode; ancestors: TreeNode[] } | null {
  let found: { node: TreeNode; ancestors: TreeNode[] } | null = null;
  walk(nodes, (node, ancestors) => {
    if (node.header.id === id) found = { node, ancestors };
  });
  return found;
}

export function collectIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  walk(nodes, (node) => ids.add(node.header.id));
  return ids;
}

export function filePath(node: TreeNode): string {
  const entry = joinEntry(node.dir, node.entryName);
  return node.kind === "group" ? joinEntry(entry, "_index.md") : entry;
}

function joinEntry(dir: string, name: string): string {
  return dir.replace(/\/+$/, "") + "/" + name;
}
