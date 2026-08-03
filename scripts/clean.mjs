import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await rm(path.join(root, "dist"), { recursive: true, force: true });
