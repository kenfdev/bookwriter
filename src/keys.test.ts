import { describe, expect, it } from "vitest";
import { formatAccelerator } from "./keys";

describe("menu shortcuts", () => {
  it("writes Mac modifiers in the standard order", () => {
    expect(formatAccelerator("CmdOrCtrl+O", true)).toBe("⌘O");
    expect(formatAccelerator("CmdOrCtrl+Shift+E", true)).toBe("⇧⌘E");
    expect(formatAccelerator("CmdOrCtrl+Alt+F", true)).toBe("⌥⌘F");
    expect(formatAccelerator("CmdOrCtrl+Shift+G", true)).toBe("⇧⌘G");
    expect(formatAccelerator("CmdOrCtrl+B", true)).toBe("⌘B");
  });

  it("writes Ctrl for other platforms", () => {
    expect(formatAccelerator("CmdOrCtrl+O", false)).toBe("Ctrl+O");
    expect(formatAccelerator("CmdOrCtrl+Shift+E", false)).toBe("Ctrl+Shift+E");
  });
});
