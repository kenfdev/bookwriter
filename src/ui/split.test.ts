import { describe, expect, it } from "vitest";
import { clampPreviewWidth, previewWidthFromPointer } from "./split";

const outline = 280;
const splitter = 6;
const min = 180;

describe("preview separator", () => {
  it("gives the preview the space to the right of the pointer", () => {
    expect(previewWidthFromPointer(1200, 0, 770, outline, splitter, min)).toBe(427);
  });

  it("grows the preview as the pointer moves left", () => {
    const left = previewWidthFromPointer(1200, 0, 500, outline, splitter, min);
    const right = previewWidthFromPointer(1200, 0, 900, outline, splitter, min);
    expect(left).toBeGreaterThan(right);
  });

  it("keeps both panes at least the minimum", () => {
    expect(previewWidthFromPointer(1200, 0, 1100, outline, splitter, min)).toBe(min);
    expect(previewWidthFromPointer(1200, 0, 100, outline, splitter, min)).toBe(1200 - outline - splitter - min);
  });

  it("uses the only width that fits in a narrow workspace", () => {
    expect(clampPreviewWidth(100, 400, min)).toBe(100);
  });

  it("leaves a stored width alone before the workspace has a size", () => {
    expect(clampPreviewWidth(0, 420, min)).toBe(420);
  });
});
