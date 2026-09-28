import { readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { nodeFs } from "../src/nodeFs";
import { writeSpecBook } from "../src/specbook";

const root = new URL("../spec-book", import.meta.url).pathname;
const spec = await readFile(new URL("../bookwriter-spec.md", import.meta.url), "utf8");
await rm(root, { recursive: true, force: true });
await writeSpecBook(nodeFs(), root, spec);
console.log(root);
