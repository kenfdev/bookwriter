import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, Fs } from "./book";

export const tauriFs: Fs = {
  readText: (path) => invoke("read_text", { path }),
  readBytes: async (path) => new Uint8Array(await invoke<ArrayBuffer>("read_bytes", { path })),
  writeText: (path, text) => invoke("write_text", { path, text }),
  readDir: (path) => invoke<DirEntry[]>("read_dir", { path }),
  rename: (from, to) => invoke("rename_path", { from, to }),
  moveFile: (from, to) => invoke("move_file", { from, to }),
  canonicalize: (path) => invoke("canonicalize_path", { path }),
  mkdir: (path) => invoke("make_dir", { path }),
};

/** Let the preview load picture files from this book folder. */
export function allowBook(root: string): Promise<void> {
  return invoke("allow_book", { root });
}

export function startupBookPath(): Promise<string> {
  return invoke("startup_book_path");
}
