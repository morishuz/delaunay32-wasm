import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("matches committed native v0.6.0 golden fixtures", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32 } = await import(packageUrl);
    const fixture = await fetch("/tests/fixtures/native-v0.6.0.json").then(
      (response) => response.json() as Promise<{
        cases: Array<{ name: string; points: number[] }>;
      }>,
    );
    const api = await createDelaunay32();
    const cases = fixture.cases.map((entry) => {
      const result = api.triangulate({
        points: new Int32Array(entry.points),
        resultDetail: "full",
      });
      return {
        name: entry.name,
        triangles: [...result.triangles],
        halfedges: [...result.halfedges],
        hull: [...result.hull],
        representatives: [...result.representatives],
      };
    });
    api.dispose();
    return cases;
  });
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/native-v0.6.0.json", import.meta.url),
      "utf8",
    ),
  ) as {
    cases: Array<{
      name: string;
      points: number[];
      triangles: number[];
      halfedges: number[];
      hull: number[];
      representatives: number[];
    }>;
  };
  expect(output).toEqual(
    fixture.cases.map(({ name, points: _points, ...expected }) => ({
      name,
      ...expected,
    })),
  );
});

test("synchronous full triangulation returns valid topology", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32 } = await import(packageUrl);
    const points = new Int32Array([
      0, 0,
      100, 0,
      100, 100,
      0, 100,
      48, 37,
    ]);
    const api = await createDelaunay32();
    const result = api.triangulate({ points, resultDetail: "full" });
    const triangles = [...result.triangles];
    const halfedges = [...result.halfedges];
    const orientations: number[] = [];
    for (let offset = 0; offset < triangles.length; offset += 3) {
      const i0 = triangles[offset] as number;
      const i1 = triangles[offset + 1] as number;
      const i2 = triangles[offset + 2] as number;
      const ax = points[i0 * 2] as number;
      const ay = points[i0 * 2 + 1] as number;
      const bx = points[i1 * 2] as number;
      const by = points[i1 * 2 + 1] as number;
      const cx = points[i2 * 2] as number;
      const cy = points[i2 * 2 + 1] as number;
      orientations.push((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    }
    api.dispose();
    return {
      triangles,
      halfedges,
      hull: [...result.hull],
      representatives: [...result.representatives],
      report: result.report,
      orientations,
    };
  });

  expect(output.triangles).toHaveLength(12);
  expect(output.halfedges).toHaveLength(output.triangles.length);
  expect(output.hull).toHaveLength(4);
  expect(output.representatives).toEqual([0, 1, 2, 3, 4]);
  expect(output.report).toMatchObject({
    inputPoints: 5,
    uniquePoints: 5,
    collapsedPoints: 0,
    actualThreadCount: 1,
  });
  expect(output.orientations.every((value) => value > 0)).toBe(true);
  for (let edge = 0; edge < output.halfedges.length; edge += 1) {
    const opposite = output.halfedges[edge] as number;
    if (opposite >= 0) expect(output.halfedges[opposite]).toBe(edge);
  }
});

test("quantization modes and duplicate representatives match native behavior", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32 } = await import(packageUrl);
    const api = await createDelaunay32();
    const fixed = api.quantize(
      new Float64Array([0.1, 0.2, 1.1, 1.2]),
      { mode: "fixed-scale", originX: 0, originY: 0, scale: 10 },
    );
    const grid = api.quantize(
      new Float32Array([0.1, 0.2, 1.1, 1.2]),
      { mode: "grid-step", gridStep: 1 },
    );
    const automatic = api.quantize(
      new Float64Array([0.1, 0.2, 1.1, 1.2]),
    );
    let collisionCode = "";
    try {
      api.quantize(new Float64Array([0, 0, 0.1, 0.1]), {
        mode: "grid-step",
        gridStep: 1,
        collisionPolicy: "reject",
      });
    } catch (error) {
      collisionCode = (error as { code?: string }).code ?? "";
    }
    let thresholdCode = "";
    try {
      api.quantize(new Float64Array([
        0, 0,
        2, 0,
        0, 2,
        0.49, 0.49,
      ]), {
        mode: "grid-step",
        gridStep: 1,
        maxCoordinateError: 0.1,
      });
    } catch (error) {
      thresholdCode = (error as { code?: string }).code ?? "";
    }
    const duplicate = api.triangulate({
      points: new Int32Array([0, 0, 10, 0, 0, 10, 0, 0]),
      resultDetail: "full",
    });
    api.dispose();
    return {
      fixed: [...fixed.points],
      fixedReport: fixed.report,
      grid: [...grid.points],
      automatic: [...automatic.points],
      automaticReport: automatic.report,
      collisionCode,
      thresholdCode,
      representatives: [...duplicate.representatives],
      duplicateReport: duplicate.report,
    };
  });
  expect(output.fixed).toEqual([1, 2, 11, 12]);
  expect(output.fixedReport).toMatchObject({
    originX: 0,
    originY: 0,
    scale: 10,
    uniquePoints: 2,
  });
  expect(output.grid).toEqual([0, 0, 1, 1]);
  expect(output.automatic).toHaveLength(4);
  expect(output.automaticReport).toMatchObject({
    uniquePoints: 2,
    collapsedPoints: 0,
  });
  expect(output.collisionCode).toBe("invalid-input");
  expect(output.thresholdCode).toBe("invalid-input");
  expect(output.representatives).toEqual([0, 1, 2, 0]);
  expect(output.duplicateReport.collapsedPoints).toBe(1);
});

test("uses the int128 predicate path at the certified large span", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32 } = await import(packageUrl);
    const api = await createDelaunay32();
    const result = api.triangulate({
      points: new Int32Array([
        0, 0,
        1_940_470_527, 0,
        0, 1_940_470_527,
      ]),
    });
    api.dispose();
    return { predicate: result.report.predicateWidth, triangles: [...result.triangles] };
  });
  expect(output.predicate).toBe("int128");
  expect(output.triangles).toEqual([2, 0, 1]);
});

test("constraints and polygon holes are preserved", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32 } = await import(packageUrl);
    const api = await createDelaunay32();
    const constrained = api.triangulate({
      points: new Int32Array([0, 0, 100, 0, 100, 100, 0, 100]),
      constraints: new Uint32Array([0, 2]),
    });
    const polygonPoints = new Int32Array([
      0, 0, 100, 0, 100, 100, 0, 100,
      30, 30, 70, 30, 70, 70, 30, 70,
    ]);
    const polygon = api.triangulate({
      points: polygonPoints,
      polygons: [{
        outerRing: new Uint32Array([0, 1, 2, 3]),
        holes: [new Uint32Array([4, 5, 6, 7])],
      }],
    });
    const multipleDomains = api.triangulate({
      points: new Int32Array([
        0, 0, 10, 0, 10, 10, 0, 10,
        30, 0, 40, 0, 40, 10, 30, 10,
      ]),
      polygons: [
        { outerRing: new Uint32Array([0, 1, 2, 3]) },
        { outerRing: new Uint32Array([4, 5, 6, 7]) },
      ],
    });
    const edges = new Set<string>();
    for (let offset = 0; offset < constrained.triangles.length; offset += 3) {
      const face = [
        constrained.triangles[offset] as number,
        constrained.triangles[offset + 1] as number,
        constrained.triangles[offset + 2] as number,
      ];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = face[edge] as number;
        const b = face[(edge + 1) % 3] as number;
        edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
    }
    const polygonCentroids: number[][] = [];
    for (let offset = 0; offset < polygon.triangles.length; offset += 3) {
      let x = 0;
      let y = 0;
      for (let local = 0; local < 3; local += 1) {
        const index = polygon.triangles[offset + local] as number;
        x += polygonPoints[index * 2] as number;
        y += polygonPoints[index * 2 + 1] as number;
      }
      polygonCentroids.push([x / 3, y / 3]);
    }
    api.dispose();
    return {
      hasConstraint: edges.has("0:2"),
      polygonTriangleCount: polygon.triangles.length / 3,
      polygonCentroids,
      multipleDomainTriangleCount: multipleDomains.triangles.length / 3,
    };
  });
  expect(output.hasConstraint).toBe(true);
  expect(output.polygonTriangleCount).toBeGreaterThan(0);
  expect(output.multipleDomainTriangleCount).toBe(4);
  expect(
    output.polygonCentroids.every(
      ([x, y]) => !(x! > 30 && x! < 70 && y! > 30 && y! < 70),
    ),
  ).toBe(true);
});

test("native sampling, quantization, and polygon triangulation run as one operation", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32, createDelaunay32Worker } =
      await import(packageUrl);
    const coordinates = [
      0, 0, 100, 0, 100, 100, 0, 100,
      40, 40, 60, 40, 60, 60, 40, 60,
    ];
    const polygons = [{
      outerRing: new Uint32Array([0, 1, 2, 3]),
      holes: [new Uint32Array([4, 5, 6, 7])],
    }];
    const input = {
      boundaryPoints: new Float64Array(coordinates),
      polygons,
      sampling: {
        mode: "jittered-grid" as const,
        pointCount: 500,
        jitter: 0.75,
        seed: 42,
      },
      quantization: {
        mode: "fixed-scale" as const,
        originX: 0,
        originY: 0,
        scale: 100,
      },
      resultDetail: "full" as const,
    };

    const sync = await createDelaunay32();
    const expected = sync.sampleAndTriangulate(input);
    const uniform = sync.sampleAndTriangulate({
      ...input,
      sampling: { mode: "uniform", pointCount: 50, seed: 7 },
      resultDetail: "triangles",
    });
    let invalidCode = "";
    try {
      sync.sampleAndTriangulate({
        ...input,
        sampling: {
          mode: "jittered-grid",
          pointCount: 10,
          jitter: 2,
        },
      });
    } catch (error) {
      invalidCode = (error as { code?: string }).code ?? "";
    }
    sync.dispose();

    const worker = await createDelaunay32Worker();
    const transferredBoundary = new Float64Array(coordinates);
    const actual = await worker.sampleAndTriangulate(
      { ...input, boundaryPoints: transferredBoundary },
      { transferInput: true },
    );
    worker.terminate();

    return {
      samePoints: [...actual.points].every(
        (value, index) => value === expected.points[index],
      ),
      sameTriangles: [...actual.triangles].every(
        (value, index) => value === expected.triangles[index],
      ),
      pointsLength: actual.points.length,
      triangleCount: actual.triangles.length / 3,
      halfedgesLength: actual.halfedges.length,
      pipeline: actual.pipelineReport,
      quantization: actual.quantizationReport,
      report: actual.report,
      firstBoundaryPoints: [...actual.points.slice(0, coordinates.length)],
      detachedBoundaryLength: transferredBoundary.byteLength,
      uniformGeneratedPoints: uniform.pipelineReport.generatedPoints,
      invalidCode,
    };
  });

  expect(output.samePoints).toBe(true);
  expect(output.sameTriangles).toBe(true);
  expect(output.pointsLength).toBe((8 + 500) * 2);
  expect(output.triangleCount).toBeGreaterThan(500);
  expect(output.halfedgesLength).toBe(output.triangleCount * 3);
  expect(output.pipeline).toMatchObject({
    boundaryPoints: 8,
    generatedPoints: 500,
  });
  expect(output.pipeline.samplingMilliseconds).toBeGreaterThanOrEqual(0);
  expect(output.pipeline.quantizationMilliseconds).toBeGreaterThanOrEqual(0);
  expect(output.pipeline.triangulationMilliseconds).toBeGreaterThanOrEqual(0);
  expect(output.quantization.uniquePoints).toBeGreaterThan(490);
  expect(output.report).toMatchObject({ inputPoints: 508, actualThreadCount: 1 });
  expect(output.firstBoundaryPoints).toEqual([
    0, 0, 10_000, 0, 10_000, 10_000, 0, 10_000,
    4_000, 4_000, 6_000, 4_000, 6_000, 6_000, 4_000, 6_000,
  ]);
  expect(output.detachedBoundaryLength).toBe(0);
  expect(output.uniformGeneratedPoints).toBe(50);
  expect(output.invalidCode).toBe("invalid-input");
});

test("worker matches sync, serializes calls, and controls input ownership", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32, createDelaunay32Worker } =
      await import(packageUrl);
    const coordinates = [0, 0, 100, 0, 100, 100, 0, 100, 48, 37];
    const sync = await createDelaunay32();
    const expected = sync.triangulate({
      points: new Int32Array(coordinates),
      resultDetail: "full",
    });
    sync.dispose();
    const worker = await createDelaunay32Worker();
    const transferred = new Int32Array(coordinates);
    const preserved = new Int32Array(coordinates);
    const preservedResult = await worker.triangulate({ points: preserved });
    const actual = await worker.triangulate(
      { points: transferred, resultDetail: "full" },
      { transferInput: true },
    );
    const queuedA = worker.triangulate({
      points: new Int32Array([0, 0, 10, 0, 0, 10]),
    });
    const queuedB = worker.quantize(
      new Float32Array([0.1, 0.2, 1.1, 1.2]),
      { mode: "grid-step", gridStep: 1 },
    );
    const [queuedTriangulation, queuedQuantization] = await Promise.all([
      queuedA,
      queuedB,
    ]);
    const detachedLength = transferred.byteLength;
    const shared = new ArrayBuffer(12 * Uint32Array.BYTES_PER_ELEMENT);
    const sharedPoints = new Int32Array(shared, 0, 8);
    sharedPoints.set([0, 0, 10, 0, 10, 10, 0, 10]);
    const sharedConstraint = new Uint32Array(
      shared,
      8 * Uint32Array.BYTES_PER_ELEMENT,
      2,
    );
    sharedConstraint.set([0, 2]);
    const sharedResult = await worker.triangulate(
      { points: sharedPoints, constraints: sharedConstraint },
      { transferInput: true },
    );
    const sharedDetachedLength = shared.byteLength;
    worker.terminate();
    return {
      expected: [...expected.triangles],
      actual: [...actual.triangles],
      expectedHalfedges: [...expected.halfedges],
      actualHalfedges: [...actual.halfedges],
      detachedLength,
      preservedLength: preserved.byteLength,
      preservedFirst: preserved[0],
      preservedTriangleCount: preservedResult.triangles.length / 3,
      queuedTriangleCount: queuedTriangulation.triangles.length / 3,
      queuedPoints: [...queuedQuantization.points],
      sharedTriangleCount: sharedResult.triangles.length / 3,
      sharedDetachedLength,
    };
  });
  expect(output.actual).toEqual(output.expected);
  expect(output.actualHalfedges).toEqual(output.expectedHalfedges);
  expect(output.detachedLength).toBe(0);
  expect(output.preservedLength).toBeGreaterThan(0);
  expect(output.preservedFirst).toBe(0);
  expect(output.preservedTriangleCount).toBe(4);
  expect(output.queuedTriangleCount).toBe(1);
  expect(output.queuedPoints).toEqual([0, 0, 1, 1]);
  expect(output.sharedTriangleCount).toBe(2);
  expect(output.sharedDetachedLength).toBe(0);
});

test("sync and worker expose matching errors and termination rejects queued work", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32, createDelaunay32Worker } =
      await import(packageUrl);
    const invalid = new Int32Array([0, 0, 0, 0, 0, 0]);
    const sync = await createDelaunay32();
    let syncCode = "";
    try {
      sync.triangulate({ points: invalid });
    } catch (error) {
      syncCode = (error as { code?: string }).code ?? "";
    }
    sync.dispose();

    const worker = await createDelaunay32Worker();
    let workerCode = "";
    try {
      await worker.triangulate({ points: invalid });
    } catch (error) {
      workerCode = (error as { code?: string }).code ?? "";
    }
    let workerQuantizationCode = "";
    try {
      await worker.quantize(new Float64Array([0, 0]), {
        mode: "grid-step",
        gridStep: Number.POSITIVE_INFINITY,
      });
    } catch (error) {
      workerQuantizationCode = (error as { code?: string }).code ?? "";
    }

    const count = 100_000;
    const points = new Int32Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      points[index * 2] = index % 500;
      points[index * 2 + 1] = Math.floor(index / 500);
    }
    const pending = worker.triangulate({ points });
    worker.terminate();
    let terminatedCode = "";
    try {
      await pending;
    } catch (error) {
      terminatedCode = (error as { code?: string }).code ?? "";
    }
    let afterTerminationCode = "";
    try {
      await worker.triangulate({
        points: new Int32Array([0, 0, 10, 0, 0, 10]),
      });
    } catch (error) {
      afterTerminationCode = (error as { code?: string }).code ?? "";
    }
    let initializationCode = "";
    try {
      await createDelaunay32Worker({
        wasmUrl: "/missing-delaunay32-module.wasm",
      });
    } catch (error) {
      initializationCode = (error as { code?: string }).code ?? "";
    }
    const customWorker = await createDelaunay32Worker({
      wasmUrl: "/dist/delaunay32-module.wasm",
      workerUrl: "/dist/worker-runtime.js",
    });
    const custom = await customWorker.triangulate({
      points: new Int32Array([0, 0, 10, 0, 0, 10]),
    });
    customWorker.terminate();
    return {
      syncCode,
      workerCode,
      workerQuantizationCode,
      terminatedCode,
      afterTerminationCode,
      initializationCode,
      customTriangleCount: custom.triangles.length / 3,
    };
  });
  expect(output).toEqual({
    syncCode: "invalid-input",
    workerCode: "invalid-input",
    workerQuantizationCode: "invalid-input",
    terminatedCode: "worker-terminated",
    afterTerminationCode: "worker-terminated",
    initializationCode: "internal",
    customTriangleCount: 1,
  });
});

test("errors are typed and a failed problem can be followed by a valid one", async ({ page }) => {
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32 } = await import(packageUrl);
    const api = await createDelaunay32();
    let invalidCode = "";
    try {
      api.triangulate({
        points: new Int32Array([0, 0, 0, 0, 0, 0]),
      });
    } catch (error) {
      invalidCode = (error as { code?: string }).code ?? "";
    }
    let invalidQuantizationCode = "";
    try {
      api.quantize(new Float64Array([0, 0]), {
        mode: "fixed-scale",
        originX: Number.NaN,
        originY: 0,
        scale: 1,
      });
    } catch (error) {
      invalidQuantizationCode = (error as { code?: string }).code ?? "";
    }
    let failedPipelineCode = "";
    try {
      api.sampleAndTriangulate({
        boundaryPoints: new Float64Array([
          0, 0, 10, 10, 0, 10, 10, 0,
        ]),
        polygons: [{ outerRing: new Uint32Array([0, 1, 2, 3]) }],
        sampling: { mode: "uniform", pointCount: 4 },
      });
    } catch (error) {
      failedPipelineCode = (error as { code?: string }).code ?? "";
    }
    const valid = api.triangulate({
      points: new Int32Array([0, 0, 10, 0, 0, 10]),
    });
    api.dispose();
    api.dispose();
    let disposedCode = "";
    try {
      api.triangulate({
        points: new Int32Array([0, 0, 10, 0, 0, 10]),
      });
    } catch (error) {
      disposedCode = (error as { code?: string }).code ?? "";
    }
    return {
      invalidCode,
      invalidQuantizationCode,
      failedPipelineCode,
      disposedCode,
      triangles: [...valid.triangles],
    };
  });
  expect(output.invalidCode).toBe("invalid-input");
  expect(output.invalidQuantizationCode).toBe("invalid-input");
  expect(output.failedPipelineCode).toBe("invalid-input");
  expect(output.disposedCode).toBe("disposed");
  expect(output.triangles).toHaveLength(3);
});

test("worker handles a memory-growing input", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Run the large memory case once per CI job.");
  await page.goto("/tests/browser/fixture.html");
  const output = await page.evaluate(async () => {
    const packageUrl = "/dist/index.js";
    const { createDelaunay32Worker } = await import(packageUrl);
    const count = 60_000;
    const points = new Int32Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      points[index * 2] = (index % 300) * 10;
      points[index * 2 + 1] = Math.floor(index / 300) * 10 + (index % 7);
    }
    const worker = await createDelaunay32Worker();
    const result = await worker.triangulate({ points });
    worker.terminate();
    return {
      inputPoints: result.report.inputPoints,
      triangleCount: result.triangles.length / 3,
    };
  });
  expect(output.inputPoints).toBe(60_000);
  expect(output.triangleCount).toBeGreaterThan(50_000);
});
