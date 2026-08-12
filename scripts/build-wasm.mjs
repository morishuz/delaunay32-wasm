import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build", "wasm");
const distributionDirectory = path.join(root, "dist");
const buildType = process.env.D32_BUILD_TYPE ?? "Release";

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}

await mkdir(buildDirectory, { recursive: true });
await mkdir(distributionDirectory, { recursive: true });

if (commandExists("emcmake") && commandExists("em++")) {
  run("emcmake", [
    "cmake",
    "-S",
    root,
    "-B",
    buildDirectory,
    `-DCMAKE_BUILD_TYPE=${buildType}`,
  ]);
  run("cmake", ["--build", buildDirectory, "--parallel"]);
} else if (commandExists("docker")) {
  const relativeBuild = "build/wasm";
  const shellCommand = [
    "emcmake cmake -S /src -B /src/" + relativeBuild,
    `-DCMAKE_BUILD_TYPE=${buildType}`,
    "&& cmake --build /src/" + relativeBuild + " --parallel",
  ].join(" ");
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${root}:/src`,
    "-w",
    "/src",
    "emscripten/emsdk:6.0.6",
    "sh",
    "-lc",
    shellCommand,
  ]);
} else {
  throw new Error(
    "Emscripten was not found. Install emsdk 6.0.6 or start Docker and rerun npm run build:wasm.",
  );
}

const artifacts = await readdir(buildDirectory);
for (const name of artifacts) {
  if (
    name === "delaunay32-module.mjs" ||
    name === "delaunay32-module.wasm" ||
    name === "delaunay32-module.wasm.map"
  ) {
    await copyFile(
      path.join(buildDirectory, name),
      path.join(distributionDirectory, name),
    );
  }
}

for (const required of ["delaunay32-module.mjs", "delaunay32-module.wasm"]) {
  await access(path.join(distributionDirectory, required), constants.R_OK);
}

