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

/** Where `cursor` sits in `[start, end)`, clamped to that span. */
export function offsetFraction(cursor: number, start: number, end: number): number {
  const span = end - start;
  if (!(span > 0) || !Number.isFinite(cursor)) return 0;
  return Math.min(1, Math.max(0, (cursor - start) / span));
}

/**
 * The block to show for a source line.
 * A line inside several blocks uses the shortest one. A line in a gap uses the nearest,
 * and a tie goes to the later block. Returns -1 when nothing qualifies.
 */
export function blockAtLine(blocks: Array<{ start: number; end: number }>, line: number): number {
  if (!Number.isFinite(line)) return -1;
  let tight = -1;
  let tightSpan = Infinity;
  for (let index = 0; index < blocks.length; index += 1) {
    const start = blocks[index].start;
    const end = blocks[index].end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (line < start || line >= end) continue;
    const span = end - start;
    const later = tight >= 0 && start >= blocks[tight].start;
    if (span < tightSpan || (span === tightSpan && later)) {
      tight = index;
      tightSpan = span;
    }
  }
  if (tight >= 0) return tight;

  let nearest = -1;
  let nearestDist = Infinity;
  for (let index = 0; index < blocks.length; index += 1) {
    const start = blocks[index].start;
    const end = blocks[index].end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const dist = line < start ? start - line : line - (end - 1);
    const later = nearest >= 0 && start >= blocks[nearest].start;
    if (dist < nearestDist || (dist === nearestDist && later)) {
      nearest = index;
      nearestDist = dist;
    }
  }
  return nearest;
}

/** Scroll offset that places `spot` `padding` pixels below the top of the pane. */
export function scrollToSpot(scrollTop: number, paneTop: number, spot: number, padding: number): number {
  return Math.max(0, scrollTop + spot - paneTop - padding);
}
