import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/worker-runtime.js",
  "dist/delaunay32-module.mjs",
  "dist/delaunay32-module.wasm",
];

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath), constants.R_OK);
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.name !== "delaunay32" || packageJson.type !== "module") {
  throw new Error("package metadata no longer matches the public release contract");
}

const wasm = await stat(path.join(root, "dist/delaunay32-module.wasm"));
if (wasm.size === 0) {
  throw new Error("compiled WebAssembly artifact is empty");
}

console.log(`Package assets verified; WebAssembly size is ${wasm.size} bytes.`);

