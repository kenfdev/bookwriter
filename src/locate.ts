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

type LineBlock = { start: number; end: number };

function finiteSpan(block: LineBlock): number | null {
  if (!Number.isFinite(block.start) || !Number.isFinite(block.end) || block.end <= block.start) return null;
  return block.end - block.start;
}

function coversLine(block: LineBlock, line: number): boolean {
  return line >= block.start && line < block.end;
}

function laterStart(blocks: LineBlock[], index: number, best: number): boolean {
  return blocks[index].start >= blocks[best].start;
}

function betterSpan(span: number, bestSpan: number, later: boolean): boolean {
  if (span < bestSpan) return true;
  return span === bestSpan && later;
}

function considerCover(blocks: LineBlock[], index: number, line: number, tight: number, tightSpan: number): number {
  const span = finiteSpan(blocks[index]);
  if (span === null || !coversLine(blocks[index], line)) return tight;
  if (tight < 0 || betterSpan(span, tightSpan, laterStart(blocks, index, tight))) return index;
  return tight;
}

function tightestCover(blocks: LineBlock[], line: number): number {
  let tight = -1;
  let tightSpan = Infinity;
  for (let index = 0; index < blocks.length; index += 1) {
    const next = considerCover(blocks, index, line, tight, tightSpan);
    if (next === tight) continue;
    tight = next;
    tightSpan = finiteSpan(blocks[next]) ?? tightSpan;
  }
  return tight;
}

function distanceTo(block: LineBlock, line: number): number {
  if (line < block.start) return block.start - line;
  return line - (block.end - 1);
}

function nearer(dist: number, bestDist: number, later: boolean): boolean {
  if (dist < bestDist) return true;
  return dist === bestDist && later;
}

function considerNearest(blocks: LineBlock[], index: number, line: number, nearest: number, nearestDist: number): number {
  if (finiteSpan(blocks[index]) === null) return nearest;
  const dist = distanceTo(blocks[index], line);
  const later = nearest >= 0 && laterStart(blocks, index, nearest);
  if (nearest < 0 || nearer(dist, nearestDist, later)) return index;
  return nearest;
}

function nearestIndex(blocks: LineBlock[], line: number): number {
  let nearest = -1;
  let nearestDist = Infinity;
  for (let index = 0; index < blocks.length; index += 1) {
    const next = considerNearest(blocks, index, line, nearest, nearestDist);
    if (next === nearest) continue;
    nearest = next;
    nearestDist = distanceTo(blocks[next], line);
  }
  return nearest;
}

function blockCovering(blocks: LineBlock[], line: number): number {
  const tight = tightestCover(blocks, line);
  if (tight >= 0) return tight;
  return nearestIndex(blocks, line);
}

/**
 * The block to show for a source line.
 * A line inside several blocks uses the shortest one. A line in a gap uses the nearest,
 * and a tie goes to the later block. Returns -1 when nothing qualifies.
 */
export function blockAtLine(blocks: LineBlock[], line: number): number {
  if (!Number.isFinite(line)) return -1;
  return blockCovering(blocks, line);
}

/** Scroll offset that places `spot` `padding` pixels below the top of the pane. */
export function scrollToSpot(scrollTop: number, paneTop: number, spot: number, padding: number): number {
  return Math.max(0, scrollTop + spot - paneTop - padding);
}
