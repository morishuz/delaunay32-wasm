import {
  DEMO_STYLE,
  paddedBounds,
  type RenderOptions,
  type ViewBounds,
} from "./rendering.js";
import { WebGLMeshRenderer } from "./webgl-mesh.js";

/** Combines fast WebGL mesh drawing with a crisp 2D polygon outline. */
export class LogoRenderer {
  readonly #meshCanvas: HTMLCanvasElement;
  readonly #outlineCanvas: HTMLCanvasElement;
  readonly #outline: CanvasRenderingContext2D;
  readonly #mesh: WebGLMeshRenderer;
  readonly #bounds: ViewBounds;
  readonly #rings: readonly Uint32Array[];

  constructor(
    meshCanvas: HTMLCanvasElement,
    outlineCanvas: HTMLCanvasElement,
    bounds: ViewBounds,
    boundaryPointCount: number,
    rings: readonly Uint32Array[],
  ) {
    const outline = outlineCanvas.getContext("2d");
    if (outline === null) throw new Error("This demo requires a 2D canvas.");

    this.#meshCanvas = meshCanvas;
    this.#outlineCanvas = outlineCanvas;
    this.#outline = outline;
    this.#bounds = paddedBounds(bounds, 0.025);
    this.#rings = rings;
    this.#mesh = new WebGLMeshRenderer(
      meshCanvas,
      this.#bounds,
      boundaryPointCount,
    );
  }

  draw(
    points: Int32Array,
    triangles: Uint32Array,
    options: RenderOptions,
  ): void {
    const pixelRatio = resizeCanvases(this.#meshCanvas, this.#outlineCanvas);
    this.#mesh.draw(points, triangles, options, pixelRatio);
    this.#drawPolygonOutline(points, options.polygonOutline, pixelRatio);
  }

  #drawPolygonOutline(
    points: Int32Array,
    visible: boolean,
    pixelRatio: number,
  ): void {
    const width = this.#outlineCanvas.width / pixelRatio;
    const height = this.#outlineCanvas.height / pixelRatio;
    const context = this.#outline;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!visible) return;

    const viewWidth = this.#bounds.maxX - this.#bounds.minX;
    const viewHeight = this.#bounds.maxY - this.#bounds.minY;
    context.strokeStyle = DEMO_STYLE.polygonOutline;
    context.lineWidth = DEMO_STYLE.lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";

    for (const ring of this.#rings) {
      context.beginPath();
      for (let offset = 0; offset < ring.length; offset += 1) {
        const index = ring[offset] as number;
        const x =
          (((points[index * 2] as number) - this.#bounds.minX) / viewWidth) *
          width;
        const y =
          height -
          (((points[index * 2 + 1] as number) - this.#bounds.minY) /
            viewHeight) *
            height;
        if (offset === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.stroke();
    }
  }
}

function resizeCanvases(
  meshCanvas: HTMLCanvasElement,
  outlineCanvas: HTMLCanvasElement,
): number {
  const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(meshCanvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(meshCanvas.clientHeight * pixelRatio));

  for (const canvas of [meshCanvas, outlineCanvas]) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  return pixelRatio;
}
