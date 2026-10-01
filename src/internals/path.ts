/** Path joins for book folders. The app runs on macOS and stores POSIX paths. */

export function joinPath(...parts: string[]): string {
  let result = "";
  for (const part of parts) {
    if (!part) continue;
    if (!result) {
      result = part;
      continue;
    }
    if (part.startsWith("/")) {
      result = part;
      continue;
    }
    result = result.replace(/\/+$/, "") + "/" + part.replace(/^\/+/, "");
  }
  return result;
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) return "/";
  return trimmed.slice(0, index);
}

export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return trimmed.slice(index + 1);
}
