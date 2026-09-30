import { describe, expect, it } from "vitest";
import { lineOffset, sourceOffset } from "./locate";

describe("source offset", () => {
  const source = "Hello\n\nWorld\n";

  it("counts lines from the start of the text", () => {
    expect(lineOffset(source, 0)).toBe(0);
    expect(lineOffset(source, 1)).toBe(6);
    expect(lineOffset(source, 2)).toBe(7);
    expect(lineOffset(source, 9)).toBe(source.length);
  });

  it("lands at a proportional spot inside the block", () => {
    expect(sourceOffset(source, 0, 1, 0)).toBe(0);
    expect(sourceOffset(source, 0, 1, 1)).toBe(6);
    expect(sourceOffset(source, 2, 3, 0)).toBe(7);
    expect(sourceOffset(source, 2, 3, 0.5)).toBe(10);
    expect(sourceOffset(source, 2, 3, 4)).toBe(13);
  });
});
