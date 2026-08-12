import { createDelaunay32Worker } from "delaunay32";
import { startDemo } from "./demo.js";

interface EmbeddedDemoAssets {
  workerBase64: string;
  wasmBase64: string;
}

declare global {
  var __DELAUNAY32_LOCAL_DEMO__: EmbeddedDemoAssets | undefined;
}

const assets = globalThis.__DELAUNAY32_LOCAL_DEMO__;
if (assets === undefined) {
  throw new Error("The self-contained demo assets are missing.");
}

// The generated root index.html injects these assets. Data URLs let the same
// worker-based example run directly under file:// without a web server.
const worker = await createDelaunay32Worker({
  workerUrl: `data:text/javascript;base64,${assets.workerBase64}`,
  wasmUrl: `data:application/wasm;base64,${assets.wasmBase64}`,
});
globalThis.__DELAUNAY32_LOCAL_DEMO__ = undefined;
startDemo(worker);
