# Delaunay32 for WebAssembly

Fast, exact 2D Delaunay triangulation in modern browsers. This package provides
the C++17 [Delaunay32](https://github.com/morishuz/delaunay32) core and point
samplers as precompiled WebAssembly behind a typed, ESM-only JavaScript API.

[![Delaunay32 WebAssembly demo showing a triangulated Delaunay32 logo](images/web_indexhtml_screenshot.png)](https://morishuz.github.io/delaunay32-wasm/)

- Exact predicates for every accepted signed 32-bit integer input
- `Int32Array`, `Float32Array`, and `Float64Array` coordinates
- Constraints, polygon domains, holes, adjacency, hulls, and duplicate maps
- Native uniform, blue-noise, and jittered-grid polygon sampling
- Synchronous API and a UI-safe module-worker API
- No runtime dependencies, `SharedArrayBuffer`, COOP, or COEP requirement
- About 230 KB of WebAssembly (87 KB gzip) in the current release build

[Try the interactive demo](https://morishuz.github.io/delaunay32-wasm/).

## Install

```sh
npm install delaunay32
```

The npm package includes the compiled WebAssembly module. Applications do not
require C++, CMake, Emscripten, Docker, or a native build step.

## Use in a worker

The worker API is the recommended choice for frontend applications because a
large triangulation cannot block rendering or input handling.

```ts
import { createDelaunay32Worker } from "delaunay32";

const delaunay = await createDelaunay32Worker();

const result = await delaunay.triangulate({
  points: new Float64Array([
    0.0, 0.0,
    100.0, 0.0,
    100.0, 100.0,
    0.0, 100.0,
    48.0, 37.0,
  ]),
  resultDetail: "full",
});

console.log(result.triangles); // Uint32Array: i0, i1, i2, ...
console.log(result.halfedges); // Int32Array: opposite edge or -1
console.log(result.hull);      // Uint32Array

delaunay.terminate();
```

`Float32Array` and `Float64Array` inputs use automatic quantization unless a
different mapping is supplied. Triangle indices always refer to the original
input order.

Worker calls clone input buffers by default. For very large one-shot buffers,
transfer ownership instead:

```ts
const result = await delaunay.triangulate(
  { points },
  { transferInput: true },
);

// points.buffer is now detached.
```

## Sample, quantize, and triangulate in one WASM pass

`sampleAndTriangulate()` keeps point generation, quantization, polygon setup,
and triangulation inside one native call. JavaScript sends only the polygon
boundary and options; the result returns the quantized coordinates and triangle
indices. The worker version avoids blocking the UI during the complete pass.

```ts
const result = await delaunay.sampleAndTriangulate({
  boundaryPoints: new Float64Array([
    0, 0,
    1000, 0,
    1000, 1000,
    0, 1000,
  ]),
  polygons: [{ outerRing: new Uint32Array([0, 1, 2, 3]) }],
  sampling: {
    mode: "jittered-grid",
    pointCount: 100_000,
    jitter: 0.75,
    seed: 42,
  },
  quantization: {
    mode: "fixed-scale",
    originX: 0,
    originY: 0,
    scale: 1,
  },
});

console.log(result.points);    // Int32Array used by result.triangles
console.log(result.triangles); // Uint32Array
console.log(result.pipelineReport);
```

Sampling modes are `"uniform"`, `"blue-noise"`, and `"jittered-grid"`.
The pipeline report separates native sampling, quantization, and triangulation
time. Worker round-trip and drawing time remain application-level measurements.

## Synchronous use

The synchronous API has the same geometry contract and is useful inside an
application-managed worker, for small inputs, and in tests.

```ts
import { createDelaunay32 } from "delaunay32";

const delaunay = await createDelaunay32();
const result = delaunay.triangulate({
  points: new Int32Array([
    0, 0,
    100, 0,
    100, 100,
    0, 100,
    48, 37,
  ]),
});

for (let face = 0; face < result.triangles.length; face += 3) {
  const i0 = result.triangles[face];
  const i1 = result.triangles[face + 1];
  const i2 = result.triangles[face + 2];
  // i0, i1, i2 are counterclockwise indices into the input array.
}

delaunay.dispose();
```

Do not use the synchronous API for large inputs on the browser's main thread.

## Constraints and polygons

Constraints are pairs of original point indices. Polygon rings contain point
indices; closing edges are implicit and either winding direction is accepted.

```ts
const result = await delaunay.triangulate({
  points,
  constraints: new Uint32Array([
    8, 12,
    12, 19,
  ]),
  polygons: [
    {
      outerRing: new Uint32Array([0, 1, 2, 3]),
      holes: [new Uint32Array([4, 5, 6, 7])],
    },
  ],
  resultDetail: "full",
});
```

Constraints may share endpoints but cannot cross away from an existing point.
Polygon validity follows the native library: rings must be simple, holes must
be strictly inside their outer ring, and outer domains must be disjoint.

## Quantization

Automatic mode uses the finest supported uniform grid for the supplied input.
Explicit modes are available when batches need the same mapping or an
application has a known grid.

```ts
const automatic = delaunay.quantize(floatPoints);

const grid = delaunay.quantize(floatPoints, {
  mode: "grid-step",
  gridStep: 0.001,
  maxCoordinateError: 0.0006,
  collisionPolicy: "reject",
});

const fixed = delaunay.quantize(floatPoints, {
  mode: "fixed-scale",
  originX: 0,
  originY: 0,
  scale: 1000,
});
```

The worker exposes the same `quantize()` method asynchronously.

## Results

Triangle detail is the default:

| Field | Type | Meaning |
| --- | --- | --- |
| `triangles` | `Uint32Array` | Three original input indices per counterclockwise face |
| `report` | object | Predicate width, thread count, and point counts |
| `quantizationReport` | object, float or sampled input | Mapping, error, and collision statistics |

Sampled results also contain the quantized `points` and a `pipelineReport` with
the boundary/generated point counts and native stage timings.

With `resultDetail: "full"`, the result additionally contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `halfedges` | `Int32Array` | Opposite flattened edge, or `-1` at a boundary |
| `hull` | `Uint32Array` | Counterclockwise hull of the complete unique input |
| `representatives` | `Uint32Array` | Lowest retained input index for each coincident point |

For triangle `t`, flattened edges `3*t`, `3*t+1`, and `3*t+2` correspond to
`i0→i1`, `i1→i2`, and `i2→i0`.

## Errors and lifecycle

All JavaScript and native failures become `Delaunay32Error` instances with one
of these codes:

- `invalid-input`
- `out-of-memory`
- `disposed`
- `worker-terminated`
- `internal`

A synchronous instance retains native allocations between operations. Call
`dispose()` when finished. A worker retains its WebAssembly instance and peak
memory until `terminate()` is called.

## Hosting

The default loader resolves `delaunay32-module.wasm` and the module-worker entry
relative to the installed JavaScript files. Most current bundlers and static
ESM servers handle this automatically.

- Serve `.wasm` as `application/wasm` to enable streaming compilation.
- Permit module workers through the site's `worker-src` Content Security Policy.
- Permit WebAssembly compilation with the CSP rules required by the target browser.
- No cross-origin isolation headers are needed for this single-core build.

Custom asset locations are supported:

```ts
await createDelaunay32({ wasmUrl: "/assets/delaunay32.wasm" });

await createDelaunay32Worker({
  wasmUrl: "/assets/delaunay32.wasm",
  workerUrl: "/assets/delaunay32-worker.js",
});
```

Worker scripts are normally required to be same-origin. If assets are served
from a CDN, copy or proxy the worker entry through the application origin.

## Browser and memory support

Version 0.1 targets current Chrome, Firefox, and Safari with ES modules,
WebAssembly, and module workers. Node.js is not an official runtime target.

The module uses growable WASM32 memory with a 2 GiB maximum. Input, topology,
and result arrays coexist during triangulation, so practical browser limits are
lower than the native library's index range. Terminating a worker is the most
reliable way to release a large WebAssembly memory allocation immediately.

## Performance

For 1,000,000 unconstrained points on an Apple M1, relative triangulation
runtime is as follows (lower is better):

| Implementation | Threads | Relative runtime |
| --- | ---: | ---: |
| Delaunay32 WASM | 1 | 1.00× |
| Delaunator JavaScript 5.1.0 | 1 | 3.71× |
| Delaunay32 native C++ | 1 | 0.81× |
| Delaunay32 native C++ | 8 (automatic) | 0.26× |

[Delaunator](https://github.com/mapbox/delaunator) is a widely used JavaScript
library for fast Delaunay triangulation of 2D points.

## Develop

Building requires Node.js 20.19 or newer and either Emscripten 6.0.6 or Docker.

```sh
git clone https://github.com/morishuz/delaunay32-wasm.git
cd delaunay32-wasm
npm install
```

The main development commands are:

```sh
npm run build
npm test
npm run test:package
npm run example
```

To test the package locally in another project, run `npm pack` and install the
resulting `.tgz` file there with `npm install /absolute/path/to/file.tgz`.

The build downloads the Delaunay32 C++ source at its pinned commit through
CMake FetchContent.

The repository root also contains a self-contained [index.html](index.html)
version of the interactive logo example. It embeds the worker, WebAssembly
module, styles, and application code, so it opens directly from a local file
without installing dependencies or starting a server. The readable Vite source
in [`examples/vite`](examples/vite) remains the integration example. After
building the package, regenerate the standalone file with:

```sh
npm run example:file
```

The Emscripten build is configured with exceptions, LTO, memory growth, a
disabled virtual filesystem, and no pthread support. The C ABI and generated
module are internal implementation details; the TypeScript API is the stable
public contract.

## License

MIT. The package wraps Delaunay32 v0.6.2; see [THIRD_PARTY.md](THIRD_PARTY.md).
