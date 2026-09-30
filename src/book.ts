import {
  assignPrefixes,
  collectIds,
  filePath,
  findNode,
  nextPrefix,
  parseSection,
  parseTitle,
  serializeSection,
  serializeTitle,
  slugify,
  uniqueId,
  walk,
  type Header,
  type TreeNode,
} from "./model";
import { baseName, joinPath, parentPath } from "./path";

export type DirEntry = { name: string; kind: "file" | "dir" };

export interface Fs {
  readText(path: string): Promise<string>;
  /** Whole file as bytes (pictures). */
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  rename(from: string, to: string): Promise<void>;
  /** Move one file, including across devices. Creates the destination directory. */
  moveFile(from: string, to: string): Promise<void>;
  canonicalize(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
}

export type Book = {
  root: string;
  title: string;
  nodes: TreeNode[];
  warnings: string[];
};

const ENTRY = /^(\d+)-(.+)$/;
export const TRASH_ID = "trash";

export function isTrash(node: TreeNode): boolean {
  return node.header.id === TRASH_ID;
}

export async function initBook(fs: Fs, root: string, title: string): Promise<void> {
  await fs.mkdir(joinPath(root, "manuscript"));
  await fs.writeText(joinPath(root, "book.yaml"), serializeTitle(title));
}

export async function loadBook(fs: Fs, root: string): Promise<Book> {
  const warnings: string[] = [];
  let title = "";
  try {
    title = parseTitle(await fs.readText(joinPath(root, "book.yaml")));
  } catch {
    title = baseName(root);
    warnings.push("This folder has no book.yaml. A title was taken from the folder name.");
  }
  if (!title) title = baseName(root);
  const manuscript = joinPath(root, "manuscript");
  let entries: DirEntry[];
  try {
    entries = await fs.readDir(manuscript);
  } catch {
    await initBook(fs, root, title);
    entries = [];
    warnings.push("Created an empty manuscript.");
  }
  const nodes = await loadChildren(fs, manuscript, entries, warnings);
  nodes.push(await loadTrash(fs, manuscript, warnings));
  const seen = new Set<string>();
  walk(nodes, (node) => {
    if (seen.has(node.header.id)) warnings.push(`Duplicate id "${node.header.id}".`);
    seen.add(node.header.id);
  });
  return { root, title, nodes, warnings };
}

async function loadTrash(fs: Fs, manuscript: string, warnings: string[]): Promise<TreeNode> {
  const dir = joinPath(manuscript, "trash");
  await fs.mkdir(dir);
  const index = joinPath(dir, "_index.md");
  const header: Header = { id: TRASH_ID, title: "Trash", synopsis: "", status: "idea", role: "body" };
  try {
    await fs.readText(index);
  } catch {
    await fs.writeText(index, serializeSection(header, ""));
  }
  const trash = await loadGroup(fs, manuscript, "trash", "", "trash", warnings);
  trash.header = { ...trash.header, id: TRASH_ID, title: "Trash" };
  return trash;
}

async function loadChildren(fs: Fs, dir: string, entries: DirEntry[], warnings: string[]): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];
  const prefixes = new Set<string>();
  const sorted = entries
    .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("__bw_tmp_"))
    .map((entry) => ({ entry, match: ENTRY.exec(entry.kind === "file" ? entry.name.replace(/\.md$/, "") : entry.name) }))
    .filter((item) => item.match && (item.entry.kind === "dir" || item.entry.name.endsWith(".md")))
    .sort((a, b) => {
      const an = Number.parseInt(a.match![1], 10);
      const bn = Number.parseInt(b.match![1], 10);
      if (an !== bn) return an - bn;
      return a.entry.name.localeCompare(b.entry.name);
    });

  for (const item of sorted) {
    const prefix = item.match![1];
    const slug = item.match![2];
    if (prefixes.has(prefix)) warnings.push(`Duplicate prefix ${prefix} in ${dir}.`);
    prefixes.add(prefix);
    if (item.entry.kind === "dir") {
      nodes.push(await loadGroup(fs, dir, item.entry.name, prefix, slug, warnings));
    } else {
      nodes.push(await loadSection(fs, dir, item.entry.name, prefix, slug, warnings));
    }
  }
  return nodes;
}

async function loadSection(
  fs: Fs,
  dir: string,
  entryName: string,
  prefix: string,
  slug: string,
  warnings: string[],
): Promise<TreeNode> {
  const path = joinPath(dir, entryName);
  const parsed = parseSection(await fs.readText(path));
  for (const warning of parsed.warnings) warnings.push(`${entryName}: ${warning}`);
  return {
    kind: "section",
    header: parsed.header,
    body: parsed.body,
    prefix,
    slug,
    dir,
    entryName,
    children: [],
  };
}

async function loadGroup(
  fs: Fs,
  dir: string,
  entryName: string,
  prefix: string,
  slug: string,
  warnings: string[],
): Promise<TreeNode> {
  const groupDir = joinPath(dir, entryName);
  const indexPath = joinPath(groupDir, "_index.md");
  let header: Header = {
    id: slug || "section",
    title: slug.replace(/-/g, " "),
    synopsis: "",
    status: "idea",
    role: "body",
  };
  let body = "";
  try {
    const parsed = parseSection(await fs.readText(indexPath));
    header = parsed.header;
    body = parsed.body;
    for (const warning of parsed.warnings) warnings.push(`${entryName}/_index.md: ${warning}`);
  } catch {
    warnings.push(`${entryName} has no _index.md.`);
  }
  const children = await loadChildren(fs, groupDir, await fs.readDir(groupDir), warnings);
  return { kind: "group", header, body, prefix, slug, dir, entryName, children };
}

export async function saveNode(fs: Fs, node: TreeNode, header: Header, body: string): Promise<void> {
  const kept: Header = { ...header, id: node.header.id };
  const text = serializeSection(kept, body);
  const path = filePath(node);
  let current = "";
  try {
    current = await fs.readText(path);
  } catch {
    current = "";
  }
  if (current !== text) await fs.writeText(path, text);
  node.header = kept;
  node.body = body;
}

export async function saveBookTitle(fs: Fs, book: Book, title: string): Promise<void> {
  await fs.writeText(joinPath(book.root, "book.yaml"), serializeTitle(title));
  book.title = title;
}

export async function createNode(
  fs: Fs,
  book: Book,
  parentId: string | null,
  kind: "group" | "section",
  title: string,
): Promise<string> {
  const parent = parentId ? findNode(book.nodes, parentId) : null;
  const dir = parent ? joinPath(parent.node.dir, parent.node.entryName) : joinPath(book.root, "manuscript");
  const onDisk = await fs.readDir(dir);
  const prefixes = onDisk
    .map((entry) => /^(\d+)-/.exec(entry.name)?.[1])
    .filter((prefix): prefix is string => Boolean(prefix));
  const id = uniqueId(title, collectIds(book.nodes));
  const prefix = nextPrefix(prefixes);
  const entryName = kind === "section" ? `${prefix}-${id}.md` : `${prefix}-${id}`;
  const header: Header = { id, title, synopsis: "", status: "idea", role: "body" };
  const text = serializeSection(header, "");
  if (kind === "group") {
    const groupDir = joinPath(dir, entryName);
    await fs.mkdir(groupDir);
    await fs.writeText(joinPath(groupDir, "_index.md"), text);
  } else {
    await fs.writeText(joinPath(dir, entryName), text);
  }
  return id;
}

export type DropZone = "before" | "after" | "inside";

type Located = {
  node: TreeNode;
  parent: TreeNode | null;
  siblings: TreeNode[];
};

function locate(nodes: TreeNode[], id: string, parent: TreeNode | null = null): Located | null {
  for (const node of nodes) {
    if (node.header.id === id) return { node, parent, siblings: nodes };
    const child = locate(node.children, id, node);
    if (child) return child;
  }
  return null;
}

function contains(node: TreeNode, id: string): boolean {
  return node.children.some((child) => child.header.id === id || contains(child, id));
}

export type SiblingPlan = { parentId: string | null; order: string[] };

/** Sibling orders after a drag. Empty when the drop would put a group inside itself. */
export function planMove(roots: TreeNode[], movingId: string, targetId: string, zone: DropZone): SiblingPlan[] {
  const moving = locate(roots, movingId);
  const target = locate(roots, targetId);
  if (!moving || !target || movingId === targetId || isTrash(moving.node)) return [];

  const intoTrash = isTrash(target.node);
  const insideGroup = intoTrash || (zone === "inside" && target.node.kind === "group");
  const newParent = insideGroup ? target.node : target.parent;
  if (newParent && (newParent.header.id === movingId || contains(moving.node, newParent.header.id))) return [];

  const sameParent = (moving.parent?.header.id ?? null) === (newParent?.header.id ?? null);
  const pool = newParent ? newParent.children : roots.filter((node) => !isTrash(node));
  const destination = pool.filter((node) => node.header.id !== movingId);
  if (insideGroup) {
    destination.push(moving.node);
  } else {
    let index = destination.findIndex((node) => node.header.id === targetId);
    if (index < 0) index = destination.length;
    if (zone === "after") index += 1;
    destination.splice(index, 0, moving.node);
  }

  if (sameParent) {
    return [{ parentId: newParent?.header.id ?? null, order: destination.map((node) => node.header.id) }];
  }
  const source = moving.siblings.filter((node) => node.header.id !== movingId && !isTrash(node));
  return [
    { parentId: moving.parent?.header.id ?? null, order: source.map((node) => node.header.id) },
    { parentId: newParent?.header.id ?? null, order: destination.map((node) => node.header.id) },
  ];
}

async function twoPhaseRename(fs: Fs, renames: { from: string; to: string }[]): Promise<void> {
  const temps: { temp: string; to: string }[] = [];
  for (let i = 0; i < renames.length; i += 1) {
    const rename = renames[i];
    const temp = joinPath(parentPath(rename.from), `__bw_tmp_${i}_${baseName(rename.to)}`);
    await fs.rename(rename.from, temp);
    temps.push({ temp, to: rename.to });
  }
  for (const temp of temps) await fs.rename(temp.temp, temp.to);
}

async function rewriteDirectory(fs: Fs, dir: string, ordered: TreeNode[]): Promise<void> {
  const prefixes = assignPrefixes(ordered.length);
  const renames: { from: string; to: string }[] = [];
  ordered.forEach((node, index) => {
    const prefix = prefixes[index];
    const name = node.kind === "section" ? `${prefix}-${node.slug}.md` : `${prefix}-${node.slug}`;
    const from = joinPath(node.dir, node.entryName);
    const to = joinPath(dir, name);
    if (from !== to) renames.push({ from, to });
    node.prefix = prefix;
    node.entryName = name;
    node.dir = dir;
  });
  await twoPhaseRename(fs, renames);
}

function nodesInOrder(roots: TreeNode[], ids: string[]): TreeNode[] {
  return ids.map((id) => {
    const found = findNode(roots, id);
    if (!found) throw new Error(`Missing node ${id} while reordering.`);
    return found.node;
  });
}

export async function moveNode(fs: Fs, book: Book, movingId: string, targetId: string, zone: DropZone): Promise<void> {
  const plans = planMove(book.nodes, movingId, targetId, zone);
  if (!plans.length) return;
  const moving = findNode(book.nodes, movingId);
  if (!moving) return;

  if (plans.length === 2) {
    const destination = plans[1];
    const destParent = destination.parentId ? findNode(book.nodes, destination.parentId) : null;
    const destDir = destParent
      ? joinPath(destParent.node.dir, destParent.node.entryName)
      : joinPath(book.root, "manuscript");
    const tempName = `__bw_tmp_${moving.node.header.id}${moving.node.kind === "section" ? ".md" : ""}`;
    await fs.rename(joinPath(moving.node.dir, moving.node.entryName), joinPath(destDir, tempName));
    const sourceDir = moving.node.dir;
    moving.node.dir = destDir;
    moving.node.entryName = tempName;
    await rewriteDirectory(fs, sourceDir, nodesInOrder(book.nodes, plans[0].order));
    await rewriteDirectory(fs, destDir, nodesInOrder(book.nodes, plans[1].order));
    return;
  }
  const dir = moving.node.dir;
  await rewriteDirectory(fs, dir, nodesInOrder(book.nodes, plans[0].order));
}

export async function deleteNode(fs: Fs, book: Book, id: string): Promise<void> {
  const target = findNode(book.nodes, id);
  if (!target || isTrash(target.node) || target.ancestors.some(isTrash)) return;
  await moveNode(fs, book, id, TRASH_ID, "inside");
}

export function manuscriptNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((node) => !isTrash(node));
}

export function slugFromTitle(title: string): string {
  return slugify(title);
}
