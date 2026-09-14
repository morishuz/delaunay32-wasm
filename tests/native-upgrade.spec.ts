import { expect, test } from "@playwright/test";

for (const worker of [false, true]) {
  test(`native upgrade clipping and quantization regressions (${worker ? "worker" : "sync"})`, async ({ page }) => {
    await page.goto("/tests/browser/fixture.html");
    const output = await page.evaluate(async (worker) => {
      const url = "/dist/index.js";
      const { createDelaunay32, createDelaunay32Worker } = await import(url);
      const api = await (worker ? createDelaunay32Worker() : createDelaunay32());
      try {
        // Upstream regression: a closed standalone loop must not stop clipping.
        const outside = await api.triangulate({
          points: new Int32Array([0, 0, 10, 0, 10, 10, 0, 10, 20, 0, 30, 0, 30, 10, 20, 10]),
          polygons: [{ outerRing: new Uint32Array([0, 1, 2, 3]) }],
          constraints: new Uint32Array([4, 5, 5, 6, 6, 7, 7, 4]),
          resultDetail: "full",
        });
        const hole = await api.triangulate({
          points: new Int32Array([0, 0, 40, 0, 40, 40, 0, 40, 10, 10, 30, 10, 30, 30, 10, 30, 15, 15, 25, 15, 25, 25, 15, 25]),
          polygons: [{ outerRing: new Uint32Array([0, 1, 2, 3]), holes: [new Uint32Array([4, 5, 6, 7])] }],
          constraints: new Uint32Array([8, 9, 9, 10, 10, 11, 11, 8]),
          resultDetail: "full",
        });
        const errors: string[] = [];
        for (const extent of [1e-310, Number.MIN_VALUE]) {
          try {
            await api.quantize(new Float64Array([0, 0, extent, 0, 0, extent]));
            errors.push("accepted");
          } catch (error) {
            errors.push((error as { code: string }).code);
          }
        }
        // A rejected operation must still permit reuse of this instance.
        const recovered = await api.triangulate({ points: new Int32Array([0, 0, 10, 0, 0, 10]) });
        return { outside: [...outside.triangles], hole: [...hole.triangles], errors, recovered: recovered.triangles.length };
      } finally {
        if (worker) api.terminate(); else api.dispose();
      }
    }, worker);
    expect(output.outside).toHaveLength(6);
    expect(output.outside.every((index: number) => index < 4)).toBe(true);
    expect(output.hole).toHaveLength(24);
    expect(output.hole.every((index: number) => index < 8)).toBe(true);
    expect(output.errors).toEqual(["invalid-input", "invalid-input"]);
    expect(output.recovered).toBe(3);
  });
}
