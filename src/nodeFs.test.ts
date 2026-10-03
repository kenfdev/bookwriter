import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFs } from "./nodeFs";

describe("node filesystem", () => {
  it("removes a path that is already gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "bookwriter-fs-"));
    await expect(nodeFs().remove(join(root, "missing"))).resolves.toBeUndefined();
  });
});
