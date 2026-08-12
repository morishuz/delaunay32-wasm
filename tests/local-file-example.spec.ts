import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

test("self-contained logo demo runs directly from a local file", async ({ page }) => {
  const supportsWebGL2 = await page.evaluate(
    () => document.createElement("canvas").getContext("webgl2") !== null,
  );
  test.skip(!supportsWebGL2, "The visual demo requires WebGL 2.");

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(pathToFileURL(path.resolve("index.html")).href);
  await expect(page.locator("#save-svg")).toBeEnabled();
  await expect(page.locator("#faces")).not.toHaveText("— triangles");
  await expect(page.locator("#status")).toHaveCount(0);
  await expect(page.locator('input[name="sampling"]')).toHaveCount(3);

  await page.locator("#fill").uncheck();
  await page.locator("#nodes").check();
  await page.locator("#polygon-nodes").check();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save-svg").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("delaunay32.svg");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const svg = await readFile(downloadPath as string, "utf8");
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('data-fill="false"');
  expect(svg).toContain('data-interior-nodes="true"');
  expect(svg).toContain('data-polygon-nodes="true"');
  expect(svg).toContain('stroke-width="0.12"');
  expect(svg).toContain("</svg>");
  expect(errors).toEqual([]);
});

test("logo demo reaches 100,000 sampled points", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "The high-count smoke test only needs one engine.");

  await page.goto(pathToFileURL(path.resolve("index.html")).href);
  await expect(page.locator("#save-svg")).toBeEnabled();
  await expect(page.locator("#points")).toHaveAttribute("max", "100000");
  await page.locator("#points").fill("100000");
  await expect(page.locator("#point-count")).toHaveText("100,000");
  await expect.poll(async () => triangleCount(await page.locator("#faces").textContent()))
    .toBeGreaterThan(180_000);
  await expect(page.locator("#save-svg")).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save-svg").click();
  const downloadPath = await (await downloadPromise).path();
  expect(downloadPath).not.toBeNull();
  expect((await stat(downloadPath as string)).size).toBeGreaterThan(1_000_000);
});

function triangleCount(label: string | null): number {
  return Number((label ?? "0").replace(/[^\d]/g, ""));
}
