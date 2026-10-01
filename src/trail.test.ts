import { describe, expect, it } from "vitest";
import { dropRedo, emptyTrail, historyStep, noteVisit, redoVisit, undoVisit } from "./trail";

describe("section undo", () => {
  it("undoes a section change after the edits made in the current visit", () => {
    expect(historyStep(2, 1)).toBe("local");
    expect(historyStep(1, 1)).toBe("local");
    expect(historyStep(0, 1)).toBe("switch");
    expect(historyStep(0, 0)).toBe("none");
  });

  it("returns to the section that was left, and redo comes back", () => {
    let trail = emptyTrail<string>();
    trail = noteVisit(trail, "introduction");
    trail = noteVisit(trail, "twenty-kills");
    const back = undoVisit(trail, "preface");
    expect(back?.to).toBe("twenty-kills");
    expect(back?.trail.undo).toEqual(["introduction"]);
    const again = undoVisit(back!.trail, "twenty-kills");
    expect(again?.to).toBe("introduction");
    const forward = redoVisit(again!.trail, "introduction");
    expect(forward?.to).toBe("twenty-kills");
    expect(redoVisit(forward!.trail, "twenty-kills")?.to).toBe("preface");
  });

  it("drops the redo branch when a new section is opened", () => {
    let trail = noteVisit(emptyTrail<string>(), "introduction");
    const back = undoVisit(trail, "twenty-kills");
    trail = noteVisit(back!.trail, "twenty-kills");
    expect(trail.redo).toEqual([]);
    expect(undoVisit(trail, "preface")?.to).toBe("twenty-kills");
  });

  it("forgets the way forward after a new edit and keeps the way back", () => {
    let trail = noteVisit(emptyTrail<string>(), "introduction");
    trail = noteVisit(trail, "twenty-kills");
    const back = undoVisit(trail, "preface")!;
    expect(dropRedo(back.trail).undo).toEqual(["introduction"]);
    expect(dropRedo(back.trail).redo).toEqual([]);
    expect(dropRedo(trail)).toBe(trail);
  });
});
