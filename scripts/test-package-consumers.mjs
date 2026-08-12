import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "delaunay32-consumers-"));

try {
  const tarball = pack(temporaryRoot);
  const fixture = path.join(temporaryRoot, "fixture");
  await mkdir(path.join(fixture, "src"), { recursive: true });
  await writeFile(
    path.join(fixture, "package.json"),
    `${JSON.stringify({ name: "delaunay32-consumer", private: true, type: "module" }, null, 2)}\n`,
  );
  await writeFile(
    path.join(fixture, "index.html"),
    `<!doctype html><html><body><main id="status">loading</main><script type="module" src="/src/main.js"></script></body></html>\n`,
  );
  await writeFile(
    path.join(fixture, "src", "main.js"),
    `import { createDelaunay32Worker } from "delaunay32";
const worker = await createDelaunay32Worker();
const result = await worker.triangulate({ points: new Int32Array([0, 0, 10, 0, 0, 10]) });
const sampled = await worker.sampleAndTriangulate({
  boundaryPoints: new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]),
  polygons: [{ outerRing: new Uint32Array([0, 1, 2, 3]) }],
  sampling: { mode: "jittered-grid", pointCount: 100, seed: 42 },
  quantization: { mode: "fixed-scale", originX: 0, originY: 0, scale: 100 },
});
document.body.dataset.triangleIndexCount = String(result.triangles.length);
document.body.dataset.sampledPointCount = String(sampled.pipelineReport.generatedPoints);
document.querySelector("#status").textContent = \`ready:\${result.triangles.join(",")}\`;
worker.terminate();
`,
  );
  installTarball(fixture, tarball);

  const browser = await chromium.launch({ headless: true });
  try {
    await verifyVanillaEsm(browser, fixture);
    buildViteFixture(fixture);
    await verifyStaticDirectory(browser, path.join(fixture, "dist"), 4182);
  } finally {
    await browser.close();
  }
  console.log("Packed package passed clean vanilla-ESM and Vite consumer checks.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function pack(destination) {
  const result = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    root,
    { npm_config_cache: path.join(destination, "npm-cache") },
  );
  const records = JSON.parse(result.stdout);
  if (!Array.isArray(records) || records.length !== 1) {
    throw new Error("npm pack did not report exactly one tarball");
  }
  return path.join(destination, records[0].filename);
}

function installTarball(fixture, tarball) {
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    fixture,
    { npm_config_cache: path.join(path.dirname(fixture), "npm-cache") },
  );
}

function buildViteFixture(fixture) {
  run(
    process.execPath,
    [path.join(root, "node_modules/vite/bin/vite.js"), "build"],
    fixture,
  );
}

async function verifyVanillaEsm(browser, fixture) {
  const vanilla = path.join(fixture, "vanilla.html");
  await writeFile(
    vanilla,
    `<!doctype html><html><body><main id="status">loading</main><script type="module">
import { createDelaunay32Worker } from "/node_modules/delaunay32/dist/index.js";
const worker = await createDelaunay32Worker();
const result = await worker.triangulate({ points: new Int32Array([0, 0, 10, 0, 0, 10]) });
const sampled = await worker.sampleAndTriangulate({
  boundaryPoints: new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]),
  polygons: [{ outerRing: new Uint32Array([0, 1, 2, 3]) }],
  sampling: { mode: "jittered-grid", pointCount: 100, seed: 42 },
  quantization: { mode: "fixed-scale", originX: 0, originY: 0, scale: 100 },
});
document.body.dataset.triangleIndexCount = String(result.triangles.length);
document.body.dataset.sampledPointCount = String(sampled.pipelineReport.generatedPoints);
document.querySelector("#status").textContent = \`ready:\${result.triangles.join(",")}\`;
worker.terminate();
</script></body></html>\n`,
  );
  await verifyStaticDirectory(browser, fixture, 4181, "/vanilla.html");
}

async function verifyStaticDirectory(browser, directory, port, pathname = "/") {
  const server = createServer(async (request, response) => {
    try {
      const requested = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const relative = decodeURIComponent(requested.pathname).replace(/^\/+/, "") || "index.html";
      const absolute = path.resolve(directory, relative);
      if (!absolute.startsWith(`${path.resolve(directory)}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const contents = await readFile(absolute);
      response.writeHead(200, { "Content-Type": contentType(absolute) });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}${pathname}`);
    await page.waitForFunction(
      () => document.body.dataset.triangleIndexCount === "3" &&
        document.body.dataset.sampledPointCount === "100",
    );
    await page.close();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
}

function contentType(filename) {
  switch (path.extname(filename)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".wasm": return "application/wasm";
    default: return "application/octet-stream";
  }
}

function run(command, args, cwd, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "unknown"})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}
