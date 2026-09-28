import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Fs } from "./book";

export function nodeFs(): Fs {
  return {
    async readText(path) {
      return readFile(path, "utf8");
    },
    async writeText(path, text) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    },
    async readDir(path) {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "dir" : "file",
      }));
    },
    async rename(from, to) {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    },
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
  };
}
