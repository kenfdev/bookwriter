export type Trail<T> = {
  undo: T[];
  redo: T[];
};

export function emptyTrail<T>(): Trail<T> {
  return { undo: [], redo: [] };
}

/** Remember the section being left. A new visit drops the redo branch. */
export function noteVisit<T>(trail: Trail<T>, frame: T | null): Trail<T> {
  if (frame === null) return trail;
  return { undo: [...trail.undo, frame], redo: [] };
}

export function undoVisit<T>(trail: Trail<T>, here: T): { trail: Trail<T>; to: T } | null {
  const to = trail.undo.at(-1);
  if (to === undefined) return null;
  return {
    trail: { undo: trail.undo.slice(0, -1), redo: [...trail.redo, here] },
    to,
  };
}

export function redoVisit<T>(trail: Trail<T>, here: T): { trail: Trail<T>; to: T } | null {
  const to = trail.redo.at(-1);
  if (to === undefined) return null;
  return {
    trail: { undo: [...trail.undo, here], redo: trail.redo.slice(0, -1) },
    to,
  };
}

export function dropRedo<T>(trail: Trail<T>): Trail<T> {
  if (trail.redo.length === 0) return trail;
  return { undo: trail.undo, redo: [] };
}

/** Edits made in this visit undo before the section change that opened it. */
export function historyStep(local: number, switches: number): "local" | "switch" | "none" {
  if (local > 0) return "local";
  if (switches > 0) return "switch";
  return "none";
}
