import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, Fs } from "./book";

export const tauriFs: Fs = {
  readText: (path) => invoke("read_text", { path }),
  writeText: (path, text) => invoke("write_text", { path, text }),
  readDir: (path) => invoke<DirEntry[]>("read_dir", { path }),
  rename: (from, to) => invoke("rename_path", { from, to }),
  mkdir: (path) => invoke("make_dir", { path }),
};

export function startupBookPath(): Promise<string> {
  return invoke("startup_book_path");
}
