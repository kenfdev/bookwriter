import { describe, expect, it } from "vitest";
import { blockAtLine, lineOffset, offsetFraction, scrollToSpot, sourceOffset } from "./locate";

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

describe("rendered block for a source line", () => {
  const blocks = [
    { start: 0, end: 2 },
    { start: 3, end: 6 },
    { start: 3, end: 4 },
    { start: 8, end: 10 },
  ];

  it("picks the shortest block that covers the line", () => {
    expect(blockAtLine(blocks, 0)).toBe(0);
    expect(blockAtLine(blocks, 3)).toBe(2);
    expect(blockAtLine(blocks, 5)).toBe(1);
  });

  it("picks the nearest later block when the line falls in a gap", () => {
    expect(blockAtLine(blocks, 2)).toBe(2);
    expect(blockAtLine(blocks, 6)).toBe(1);
    expect(blockAtLine(blocks, 7)).toBe(3);
    expect(blockAtLine(blocks, 40)).toBe(3);
    expect(blockAtLine([], 0)).toBe(-1);
  });

  it("turns a cursor into a fraction of its block and a scroll offset", () => {
    expect(offsetFraction(10, 7, 13)).toBeCloseTo(0.5);
    expect(offsetFraction(0, 7, 13)).toBe(0);
    expect(offsetFraction(20, 7, 13)).toBe(1);
    expect(scrollToSpot(100, 40, 90, 48)).toBe(102);
    expect(scrollToSpot(10, 40, 50, 48)).toBe(0);
  });
});
