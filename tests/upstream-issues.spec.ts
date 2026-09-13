import { expect, test } from '@playwright/test';

// https://github.com/mapbox/delaunator/issues/94
// https://github.com/kninnug/Constrainautor/issues/15
const coordinates = [
  0, 0,
  0.05626429153399996, 0,
  0.024093852080076722, 4.80267923973791e-18,
  0.01379050745122589, 0.1463775332929564,
  0.05177587092034522, 0.015468457826306506,
  0.024093852080076705, -5.204170427930421e-18,
];

for (const worker of [false, true]) {
  test(`upstream near-duplicate handling (${worker ? 'worker' : 'sync'})`, async ({ page }) => {
    await page.goto('/tests/browser/fixture.html');
    const result = await page.evaluate(async ({ coordinates, worker }) => {
      const url = '/dist/index.js';
      const { createDelaunay32, createDelaunay32Worker } = await import(url);
      const api = await (worker ? createDelaunay32Worker() : createDelaunay32());
      const points = new Float64Array(coordinates);
      const quantized = await api.quantize(points);
      const outcomes = [];
      for (const constraints of [undefined, [0, 5, 5, 2], [0, 5]]) {
        for (const collisionPolicy of ['allow', 'reject']) {
          try {
            const r = await api.triangulate({ points, constraints: constraints && new Uint32Array(constraints), resultDetail: 'full', quantization: { collisionPolicy } });
            outcomes.push({ constraints, collisionPolicy, triangles: [...r.triangles], halfedges: [...r.halfedges], representatives: [...r.representatives], hull: [...r.hull], report: r.report, quantizationReport: r.quantizationReport });
          } catch (e) {
            const error = e as { code: string; message: string };
            outcomes.push({ constraints, collisionPolicy, error: { code: error.code, message: error.message } });
          }
        }
      }
      if (worker) api.terminate(); else api.dispose();
      return { quantized: { points: [...quantized.points], report: quantized.report }, outcomes };
    }, { coordinates, worker });
    expect(result.quantized.report).toMatchObject({ uniquePoints: 5, collapsedPoints: 1 });
    const [plain, reject, constrained, constrainedReject, cleaned, cleanedReject] = result.outcomes;
    for (const r of [plain!, cleaned!]) {
      expect(r.error).toBeUndefined();
      expect(r.representatives).toEqual([0, 1, 2, 3, 4, 2]);
      expect(r.report).toMatchObject({ inputPoints: 6, uniquePoints: 5, collapsedPoints: 1 });
      validateTopology({ points: result.quantized.points, triangles: r.triangles!, halfedges: r.halfedges!, hull: r.hull!, representatives: r.representatives! });
    }
    expect(constrained!.error).toEqual({ code: 'invalid-input', message: 'constraint endpoints are coincident' });
    for (const r of [reject!, constrainedReject!, cleanedReject!]) {
      expect(r.error).toEqual({ code: 'invalid-input', message: 'quantization produced coincident points' });
    }
    // Removing only the collapsed [5, 2] edge leaves [0, 5], remapped to [0, 2].
    const triangles = cleaned!.triangles!;
    expect(triangles.some((v: number, i: number) => {
      const w = triangles[i % 3 === 2 ? i - 2 : i + 1];
      return (v === 0 && w === 2) || (v === 2 && w === 0);
    })).toBe(true);
  });
}

for (const name of ['robustness1', 'ukraine']) {
  for (const worker of [false, true]) {
    test(`${name} point coverage (${worker ? 'worker' : 'sync'})`, async ({ page }) => {
      await page.goto('/tests/browser/fixture.html');
      const result = await page.evaluate(async ({ name, worker }) => {
        const coordinates = await fetch(`/tests/fixtures/delaunator-${name}.json`).then(r => r.json());
        const url = '/dist/index.js';
        const { createDelaunay32, createDelaunay32Worker } = await import(url);
        const api = await (worker ? createDelaunay32Worker() : createDelaunay32());
        try {
          const points = new Float64Array(coordinates.flat());
          const q = await api.quantize(points);
          const r = await api.triangulate({ points, resultDetail: 'full' });
          return { points: [...q.points], triangles: [...r.triangles], halfedges: [...r.halfedges], hull: [...r.hull], representatives: [...r.representatives], report: r.report, quantizationReport: r.quantizationReport };
        } finally { if (worker) api.terminate(); else api.dispose(); }
      }, { name, worker });
      expect(result.report).toMatchObject(name === 'robustness1'
        ? { inputPoints: 79, uniquePoints: 65, collapsedPoints: 14 }
        : { inputPoints: 874, uniquePoints: 867, collapsedPoints: 7 });
      expect(result.representatives.every((p: number) => result.triangles.includes(p))).toBe(true);
      validateTopology(result);
    });
  }
}

function validateTopology(r: { points: number[]; triangles: number[]; halfedges: number[]; hull: number[]; representatives: number[] }) {
  const { points, triangles, halfedges, hull, representatives } = r;
  expect(halfedges.length).toBe(triangles.length);
  const next = (i: number) => i % 3 === 2 ? i - 2 : i + 1;
  const x = (p: number) => BigInt(points[2 * p]!);
  const y = (p: number) => BigInt(points[2 * p + 1]!);
  const failures: string[] = [];
  const edges = new Map<string, number>();
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = triangles.slice(i, i + 3) as [number, number, number];
    if ((x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a)) <= 0n) failures.push(`orientation ${i / 3}`);
  }
  for (let i = 0; i < halfedges.length; ++i) {
    const a = triangles[i]!;
    const b = triangles[next(i)]!;
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
    const j = halfedges[i]!;
    if (j >= 0) {
      if (halfedges[j] !== i || a !== triangles[next(j)] || b !== triangles[j]) failures.push(`halfedge ${i}`);
      // Exact local Delaunay legality on the quantized grid; zero permits cocircular ties.
      const c = triangles[next(next(i))]!;
      const d = triangles[next(next(j))]!;
      const ax = x(a) - x(d), ay = y(a) - y(d);
      const bx = x(b) - x(d), by = y(b) - y(d);
      const cx = x(c) - x(d), cy = y(c) - y(d);
      const det = (ax * ax + ay * ay) * (bx * cy - by * cx)
        - (bx * bx + by * by) * (ax * cy - ay * cx)
        + (cx * cx + cy * cy) * (ax * by - ay * bx);
      if (det > 0n) failures.push(`incircle ${i}`);
    }
  }
  if ([...edges.values()].some(n => n > 2)) failures.push('nonmanifold edges');
  const boundary = new Set([...edges].filter(([, n]) => n === 1).map(([key]) => key));
  expect(boundary.size).toBe(hull.length);
  for (let i = 0; i < hull.length; ++i) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
    if (!boundary.has(`${Math.min(a, b)},${Math.max(a, b)}`)) failures.push(`hull ${i}`);
  }
  expect(triangles.length / 3).toBe(2 * new Set(representatives).size - 2 - hull.length);
  const used = new Set(triangles);
  for (let p = 0; p < representatives.length; ++p) {
    const rep = representatives[p]!;
    if (points[2 * p] !== points[2 * rep] || points[2 * p + 1] !== points[2 * rep + 1]) failures.push(`representative ${p}`);
    if (!used.has(rep)) failures.push(`missing representative ${p}`);
  }
  expect(failures).toEqual([]);
}
