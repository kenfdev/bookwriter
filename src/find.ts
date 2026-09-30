import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

export type FindPart = { id: string; text: string };

export type FindHit = { id: string; from: number; to: number };

function matches(text: string, query: SearchQuery, from: number, to: number): Array<{ from: number; to: number }> {
  const start = Math.max(0, Math.min(from, text.length));
  const end = Math.max(start, Math.min(to, text.length));
  if (start >= end) return [];
  const cursor = query.getCursor(EditorState.create({ doc: text }), start, end);
  const found: Array<{ from: number; to: number }> = [];
  for (;;) {
    const step = cursor.next() as { done: boolean; value: { from: number; to: number } };
    if (step.done) return found;
    found.push({ from: step.value.from, to: step.value.to });
  }
}

function searchable(query: SearchQuery, parts: FindPart[]): boolean {
  return query.valid && parts.length > 0;
}

function partAt(parts: FindPart[], currentId: string, from: number, missing: { index: number; from: number }): { index: number; from: number } {
  const index = parts.findIndex((part) => part.id === currentId);
  if (index < 0) return missing;
  return { index, from };
}

function endOf(parts: FindPart[]): { index: number; from: number } {
  const index = parts.length - 1;
  return { index, from: parts[index].text.length };
}

function firstIn(part: FindPart, query: SearchQuery, from: number, to: number): FindHit | null {
  const hit = matches(part.text, query, from, to)[0];
  if (!hit) return null;
  return { id: part.id, ...hit };
}

function lastIn(part: FindPart, query: SearchQuery, from: number, to: number): FindHit | null {
  const hits = matches(part.text, query, from, to);
  if (!hits.length) return null;
  return { id: part.id, ...hits[hits.length - 1] };
}

function lastBefore(part: FindPart, query: SearchQuery, from: number): FindHit | null {
  const hits = matches(part.text, query, 0, from).filter((hit) => hit.from < from);
  if (!hits.length) return null;
  return { id: part.id, ...hits[hits.length - 1] };
}

function scan(
  parts: FindPart[],
  start: number,
  end: number,
  step: number,
  pick: (part: FindPart) => FindHit | null,
): FindHit | null {
  for (let i = start; step > 0 ? i < end : i > end; i += step) {
    const hit = pick(parts[i]);
    if (hit) return hit;
  }
  return null;
}

/** The next match after `from` in the current text, then later texts, then back around the book. */
export function nextMatch(parts: FindPart[], currentId: string, from: number, query: SearchQuery): FindHit | null {
  if (!searchable(query, parts)) return null;
  const here = partAt(parts, currentId, from, { index: 0, from: 0 });
  const current = parts[here.index];
  const ahead = firstIn(current, query, here.from, current.text.length);
  if (ahead) return ahead;
  const later = scan(parts, here.index + 1, parts.length, 1, (part) => firstIn(part, query, 0, part.text.length));
  if (later) return later;
  const earlier = scan(parts, 0, here.index, 1, (part) => firstIn(part, query, 0, part.text.length));
  if (earlier) return earlier;
  return firstIn(current, query, 0, here.from);
}

/** The previous match before `from`, walking backward through the book and wrapping to the end. */
export function previousMatch(parts: FindPart[], currentId: string, from: number, query: SearchQuery): FindHit | null {
  if (!searchable(query, parts)) return null;
  const here = partAt(parts, currentId, from, endOf(parts));
  const current = parts[here.index];
  const behind = lastBefore(current, query, here.from);
  if (behind) return behind;
  const whole = (part: FindPart) => lastIn(part, query, 0, part.text.length);
  const earlier = scan(parts, here.index - 1, -1, -1, whole);
  if (earlier) return earlier;
  const later = scan(parts, parts.length - 1, here.index, -1, whole);
  if (later) return later;
  return lastIn(current, query, here.from, current.text.length);
}
