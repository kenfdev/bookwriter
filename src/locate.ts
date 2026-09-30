/** Offset of the start of a 0-based line. A line past the end is the end of the text. */
export function lineOffset(source: string, line: number): number {
  if (line <= 0) return 0;
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = source.indexOf("\n", offset);
    if (next < 0) return source.length;
    offset = next + 1;
  }
  return offset;
}

/**
 * A spot in `source` for a click that landed `fraction` of the way through the
 * block covering [startLine, endLine). The fraction is approximate.
 */
export function sourceOffset(source: string, startLine: number, endLine: number, fraction: number): number {
  const start = lineOffset(source, startLine);
  const end = lineOffset(source, Math.max(startLine, endLine));
  const span = end - start;
  const through = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return start + Math.round(span * through);
}
