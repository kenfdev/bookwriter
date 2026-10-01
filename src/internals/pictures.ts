import type { Fs } from "./book";
import { baseName, joinPath } from "./path";

/** Picture files live here, beside `manuscript/`. Paths in the text are counted from the book folder. */
export const IMAGES_DIR = "images";

export const PICTURE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "tif", "tiff"];

/** Collapse `.` and `..` without consulting the process working directory. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined;
}

/** Path of `file` inside `bookRoot`, or null when `file` is outside the book. */
export function relativeToBook(bookRoot: string, file: string): string | null {
  const root = normalizePath(bookRoot).replace(/\/+$/, "") || "/";
  const target = normalizePath(file);
  if (root === "/") {
    if (!target.startsWith("/")) return null;
    const relative = target.slice(1);
    return relative && !relative.split("/").includes("..") ? relative : null;
  }
  const prefix = `${root}/`;
  if (!target.startsWith(prefix)) return null;
  const relative = target.slice(prefix.length);
  if (!relative || relative.split("/").includes("..")) return null;
  return relative;
}

function isPictureName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return PICTURE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

function imageFileName(name: string): string {
  const cleaned = name.replace(/[<>\r\n]/g, "").trim();
  return cleaned || "picture";
}

function uniqueFileName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n += 1;
  return `${stem}-${n}${ext}`;
}

async function isDirectory(fs: Fs, path: string): Promise<boolean> {
  try {
    await fs.readDir(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move `source` into the book's `images/` directory.
 * Returns the path to write into the text, relative to the book folder.
 * A file already in `images/` stays where it is.
 */
export async function placePicture(fs: Fs, bookRoot: string, source: string): Promise<string> {
  const root = normalizePath(await fs.canonicalize(bookRoot));
  const from = normalizePath(await fs.canonicalize(source));
  const name = imageFileName(baseName(from));
  if (!isPictureName(name) || (await isDirectory(fs, from))) {
    throw new Error("Choose a picture file.");
  }
  const existing = relativeToBook(root, from);
  if (existing?.startsWith(`${IMAGES_DIR}/`)) return existing;

  const imagesRoot = joinPath(root, IMAGES_DIR);
  await fs.mkdir(imagesRoot);
  const entries = await fs.readDir(imagesRoot);
  const taken = new Set(entries.map((entry) => entry.name));
  const stored = uniqueFileName(taken, name);
  await fs.moveFile(from, joinPath(imagesRoot, stored));
  return `${IMAGES_DIR}/${stored}`;
}

/**
 * Point `<img>` sources at the book folder.
 * A path that would leave the book is left unloaded. A URL with a scheme is left as written.
 */
export function resolvePictureSources(html: string, toUrl: (bookRelative: string) => string): string {
  return html.replace(/<img\b[^>]*>/g, (tag) =>
    tag.replace(/\bsrc="([^"]*)"/, (full, src: string) => {
      const relative = bookPicturePath(src);
      if (relative === null) return "";
      if (relative === false) return full;
      return `src="${escapeAttribute(toUrl(relative))}"`;
    }),
  );
}

/** A book-relative path, `false` when `src` is already a URL, or null when it leaves the book. */
export function bookPicturePath(src: string): string | false | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    decoded = src;
  }
  const normalized = normalizePath(decoded.replace(/^\/+/, ""));
  if (!normalized || normalized.split("/").includes("..")) return null;
  return normalized;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
