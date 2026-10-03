import { describe, expect, it } from "vitest";
import { parentPath } from "./path";

describe("parent paths", () => {
  it("returns the directory above a file", () => {
    expect(parentPath("/usr")).toBe("/");
    expect(parentPath("x/y")).toBe("x");
    expect(parentPath("/usr/local")).toBe("/usr");
  });
});
