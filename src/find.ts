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

/** The next match after `from` in the current text, then later texts, then back around the book. */
export function nextMatch(parts: FindPart[], currentId: string, from: number, query: SearchQuery): FindHit | null {
  if (!query.valid || parts.length === 0) return null;
  let index = parts.findIndex((part) => part.id === currentId);
  if (index < 0) {
    index = 0;
    from = 0;
  }
  const current = parts[index];
  const ahead = matches(current.text, query, from, current.text.length);
  if (ahead.length) return { id: current.id, ...ahead[0] };
  for (let i = index + 1; i < parts.length; i += 1) {
    const hit = matches(parts[i].text, query, 0, parts[i].text.length)[0];
    if (hit) return { id: parts[i].id, ...hit };
  }
  for (let i = 0; i < index; i += 1) {
    const hit = matches(parts[i].text, query, 0, parts[i].text.length)[0];
    if (hit) return { id: parts[i].id, ...hit };
  }
  const wrapped = matches(current.text, query, 0, from);
  if (wrapped.length) return { id: current.id, ...wrapped[0] };
  return null;
}

/** The previous match before `from`, walking backward through the book and wrapping to the end. */
export function previousMatch(parts: FindPart[], currentId: string, from: number, query: SearchQuery): FindHit | null {
  if (!query.valid || parts.length === 0) return null;
  let index = parts.findIndex((part) => part.id === currentId);
  if (index < 0) {
    index = parts.length - 1;
    from = parts[index].text.length;
  }
  const current = parts[index];
  const behind = matches(current.text, query, 0, from).filter((hit) => hit.from < from);
  if (behind.length) return { id: current.id, ...behind[behind.length - 1] };
  for (let i = index - 1; i >= 0; i -= 1) {
    const hits = matches(parts[i].text, query, 0, parts[i].text.length);
    if (hits.length) return { id: parts[i].id, ...hits[hits.length - 1] };
  }
  for (let i = parts.length - 1; i > index; i -= 1) {
    const hits = matches(parts[i].text, query, 0, parts[i].text.length);
    if (hits.length) return { id: parts[i].id, ...hits[hits.length - 1] };
  }
  const wrapped = matches(current.text, query, from, current.text.length);
  if (wrapped.length) return { id: current.id, ...wrapped[wrapped.length - 1] };
  return null;
}
