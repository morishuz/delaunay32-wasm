import type {
  Delaunay32Worker,
  SampledTriangulationResult,
  SamplingOptions,
} from "delaunay32";
import { LOGO } from "./logo.js";
import { LogoRenderer } from "./renderer.js";
import type { RenderOptions } from "./rendering.js";
import { createDemoSvg, downloadSvg } from "./svg-export.js";

type SamplingMode = SamplingOptions["mode"];

interface DisplayInputs {
  fill: HTMLInputElement;
  triangleEdges: HTMLInputElement;
  nodes: HTMLInputElement;
  polygonNodes: HTMLInputElement;
  polygonOutline: HTMLInputElement;
}

interface DemoElements {
  meshCanvas: HTMLCanvasElement;
  outlineCanvas: HTMLCanvasElement;
  pointInput: HTMLInputElement;
  pointCountOutput: HTMLOutputElement;
  samplingInputs: HTMLInputElement[];
  displayInputs: DisplayInputs;
  resampleButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  faceOutput: HTMLElement;
  durationOutput: HTMLElement;
}

export function startDemo(worker: Delaunay32Worker): void {
  const elements = findDemoElements();
  const renderer = new LogoRenderer(
    elements.meshCanvas,
    elements.outlineCanvas,
    LOGO.bounds,
    LOGO.boundaryPointCount,
    LOGO.rings,
  );

  let nextSeed = 1;
  let latestResult: SampledTriangulationResult | undefined;
  let rerunRequested = false;
  let running = false;
  let scheduledFrame: number | undefined;

  elements.pointInput.addEventListener("input", () => {
    elements.pointCountOutput.textContent = formatInteger(
      Number(elements.pointInput.value),
    );
    requestTriangulation();
  });
  for (const input of elements.samplingInputs) {
    input.addEventListener("change", requestTriangulation);
  }
  for (const input of Object.values(elements.displayInputs)) {
    input.addEventListener("change", redraw);
  }
  elements.resampleButton.addEventListener("click", requestTriangulation);
  elements.saveButton.addEventListener("click", saveSvg);

  const resizeObserver = new ResizeObserver(() => {
    if (latestResult !== undefined) requestAnimationFrame(redraw);
  });
  resizeObserver.observe(elements.meshCanvas);
  window.addEventListener(
    "beforeunload",
    () => {
      resizeObserver.disconnect();
      worker.terminate();
    },
    { once: true },
  );

  requestTriangulation();

  // Slider events can arrive faster than a worker call completes. One animation
  // frame coalesces bursts, while the loop below guarantees the latest state runs.
  function requestTriangulation(): void {
    rerunRequested = true;
    if (running || scheduledFrame !== undefined) return;

    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = undefined;
      void runRequestedTriangulations();
    });
  }

  async function runRequestedTriangulations(): Promise<void> {
    if (running) return;
    running = true;
    setBusy(true);

    try {
      do {
        rerunRequested = false;
        await triangulate();
      } while (rerunRequested);
    } finally {
      running = false;
      setBusy(false);
    }
  }

  async function triangulate(): Promise<void> {
    try {
      const start = performance.now();
      const result = await worker.sampleAndTriangulate({
        boundaryPoints: LOGO.boundaryPoints,
        polygons: LOGO.polygons,
        sampling: samplingOptions(
          selectedSamplingMode(elements.samplingInputs),
          Number(elements.pointInput.value),
          nextSeed++,
        ),
        // The logo already uses integer coordinates, so scale 1 preserves its
        // boundary exactly while generated samples are quantized to the same grid.
        quantization: {
          mode: "fixed-scale",
          originX: 0,
          originY: 0,
          scale: 1,
        },
      });
      const elapsed = performance.now() - start;

      latestResult = result;
      redraw();
      elements.faceOutput.textContent =
        `${formatInteger(result.triangles.length / 3)} triangles`;
      elements.durationOutput.textContent = `${formatDuration(elapsed)} total`;
    } catch (error) {
      console.error(error);
    }
  }

  function redraw(): void {
    if (latestResult === undefined) return;
    renderer.draw(
      latestResult.points,
      latestResult.triangles,
      currentRenderOptions(elements.displayInputs),
    );
  }

  function saveSvg(): void {
    if (latestResult === undefined) return;
    downloadSvg(
      createDemoSvg({
        points: latestResult.points,
        triangles: latestResult.triangles,
        bounds: LOGO.bounds,
        boundaryPointCount: LOGO.boundaryPointCount,
        rings: LOGO.rings,
        options: currentRenderOptions(elements.displayInputs),
      }),
    );
  }

  function setBusy(busy: boolean): void {
    elements.resampleButton.disabled = busy;
    elements.saveButton.disabled = busy || latestResult === undefined;
  }
}

function findDemoElements(): DemoElements {
  return {
    meshCanvas: element("mesh"),
    outlineCanvas: element("outline"),
    pointInput: element("points"),
    pointCountOutput: element("point-count"),
    samplingInputs: Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="sampling"]'),
    ),
    displayInputs: {
      fill: element("fill"),
      triangleEdges: element("triangle-edges"),
      nodes: element("nodes"),
      polygonNodes: element("polygon-nodes"),
      polygonOutline: element("polygon-outline"),
    },
    resampleButton: element("resample"),
    saveButton: element("save-svg"),
    faceOutput: element("faces"),
    durationOutput: element("duration"),
  };
}

function currentRenderOptions(inputs: DisplayInputs): RenderOptions {
  return {
    fill: inputs.fill.checked,
    triangleEdges: inputs.triangleEdges.checked,
    nodes: inputs.nodes.checked,
    polygonNodes: inputs.polygonNodes.checked,
    polygonOutline: inputs.polygonOutline.checked,
  };
}

function samplingOptions(
  mode: SamplingMode,
  pointCount: number,
  seed: number,
): SamplingOptions {
  if (mode === "uniform") return { mode, pointCount, seed };
  if (mode === "blue-noise") {
    return { mode, pointCount, seed, candidatesPerPoint: 16 };
  }
  return { mode, pointCount, seed, jitter: 0.75 };
}

function selectedSamplingMode(inputs: readonly HTMLInputElement[]): SamplingMode {
  const value = inputs.find((input) => input.checked)?.value;
  if (isSamplingMode(value)) return value;
  return "jittered-grid";
}

function isSamplingMode(value: string | undefined): value is SamplingMode {
  return (
    value === "uniform" ||
    value === "blue-noise" ||
    value === "jittered-grid"
  );
}

function element<T extends HTMLElement>(id: string): T {
  const selected = document.getElementById(id);
  if (selected === null) throw new Error(`Missing #${id}.`);
  return selected as T;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 10) return `${milliseconds.toFixed(1)} ms`;
  return `${Math.round(milliseconds)} ms`;
}
