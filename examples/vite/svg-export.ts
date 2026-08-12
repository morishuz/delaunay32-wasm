import {
  DEMO_STYLE,
  paddedBounds,
  type RenderOptions,
  type ViewBounds,
} from "./rendering.js";

const SVG_WIDTH = 1_200;
const SVG_HEIGHT = 315;
const POINT_RADIUS = 1;

export interface SvgExportInput {
  points: Int32Array;
  triangles: Uint32Array;
  bounds: ViewBounds;
  boundaryPointCount: number;
  rings: readonly Uint32Array[];
  options: RenderOptions;
}

export function createDemoSvg(input: SvgExportInput): string {
  const bounds = paddedBounds(input.bounds, 0.025);
  const transform = screenTransform(bounds);
  const elements: string[] = [
    `<title>Delaunay32 polygon triangulation</title>`,
  ];

  appendTriangles(elements, input, transform);
  appendPoints(elements, input, transform);
  appendPolygonOutline(elements, input, transform);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}"`,
    ` data-fill="${input.options.fill}" data-triangle-edges="${input.options.triangleEdges}"`,
    ` data-interior-nodes="${input.options.nodes}" data-polygon-nodes="${input.options.polygonNodes}"`,
    ` data-polygon-outline="${input.options.polygonOutline}" shape-rendering="geometricPrecision">`,
    ...elements,
    `</svg>`,
    ``,
  ].join("\n");
}

export function downloadSvg(svg: string, filename = "delaunay32.svg"): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface ScreenTransform {
  point(points: Int32Array, index: number): readonly [number, number];
}

function screenTransform(bounds: ViewBounds): ScreenTransform {
  const scaleX = SVG_WIDTH / (bounds.maxX - bounds.minX);
  const scaleY = SVG_HEIGHT / (bounds.maxY - bounds.minY);
  return {
    point(points, index) {
      const x = ((points[index * 2] as number) - bounds.minX) * scaleX;
      const y = SVG_HEIGHT -
        ((points[index * 2 + 1] as number) - bounds.minY) * scaleY;
      return [x, y];
    },
  };
}

function appendTriangles(
  elements: string[],
  input: SvgExportInput,
  transform: ScreenTransform,
): void {
  if ((!input.options.fill && !input.options.triangleEdges) || input.triangles.length === 0) {
    return;
  }

  const pathGroups = Array.from(
    { length: input.options.fill ? DEMO_STYLE.trianglePalette.length : 1 },
    () => [] as string[],
  );
  for (let offset = 0; offset < input.triangles.length; offset += 3) {
    const i0 = input.triangles[offset] as number;
    const i1 = input.triangles[offset + 1] as number;
    const i2 = input.triangles[offset + 2] as number;
    const color = input.options.fill ? triangleColorIndex(i0, i1, i2) : 0;
    pathGroups[color]?.push(trianglePath(input.points, transform, i0, i1, i2));
  }

  for (let color = 0; color < pathGroups.length; color += 1) {
    const paths = pathGroups[color] as string[];
    if (paths.length === 0) continue;
    const fill = input.options.fill
      ? DEMO_STYLE.trianglePalette[color] as string
      : "none";
    const stroke = input.options.triangleEdges
      ? ` stroke="${DEMO_STYLE.triangleEdge}" stroke-width="${DEMO_STYLE.svgLineWidth}" stroke-linejoin="round"`
      : "";
    elements.push(`<path d="${paths.join("")}" fill="${fill}"${stroke}/>`);
  }
}

function appendPoints(
  elements: string[],
  input: SvgExportInput,
  transform: ScreenTransform,
): void {
  if (!input.options.nodes && !input.options.polygonNodes) return;
  const paths: string[] = [];
  if (input.options.polygonNodes) {
    for (let index = 0; index < input.boundaryPointCount; index += 1) {
      paths.push(pointPath(input.points, transform, index));
    }
  }
  if (input.options.nodes) {
    for (let index = input.boundaryPointCount; index < input.points.length / 2; index += 1) {
      paths.push(pointPath(input.points, transform, index));
    }
  }
  if (paths.length > 0) {
    elements.push(
      `<path d="${paths.join("")}" fill="${DEMO_STYLE.point}" fill-opacity="${DEMO_STYLE.pointOpacity}"/>`,
    );
  }
}

function appendPolygonOutline(
  elements: string[],
  input: SvgExportInput,
  transform: ScreenTransform,
): void {
  if (!input.options.polygonOutline) return;
  const paths: string[] = [];
  for (const ring of input.rings) {
    if (ring.length === 0) continue;
    const [firstX, firstY] = transform.point(input.points, ring[0] as number);
    let path = `M${coordinate(firstX)} ${coordinate(firstY)}`;
    for (let offset = 1; offset < ring.length; offset += 1) {
      const [x, y] = transform.point(input.points, ring[offset] as number);
      path += `L${coordinate(x)} ${coordinate(y)}`;
    }
    paths.push(`${path}Z`);
  }
  if (paths.length > 0) {
    elements.push(
      `<path d="${paths.join("")}" fill="none" stroke="${DEMO_STYLE.polygonOutline}" stroke-width="${DEMO_STYLE.svgLineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
}

function trianglePath(
  points: Int32Array,
  transform: ScreenTransform,
  i0: number,
  i1: number,
  i2: number,
): string {
  const [x0, y0] = transform.point(points, i0);
  const [x1, y1] = transform.point(points, i1);
  const [x2, y2] = transform.point(points, i2);
  return `M${coordinate(x0)} ${coordinate(y0)}L${coordinate(x1)} ${coordinate(y1)}L${coordinate(x2)} ${coordinate(y2)}Z`;
}

function pointPath(
  points: Int32Array,
  transform: ScreenTransform,
  index: number,
): string {
  const [x, y] = transform.point(points, index);
  const left = coordinate(x - POINT_RADIUS);
  const centerY = coordinate(y);
  return `M${left} ${centerY}a${POINT_RADIUS} ${POINT_RADIUS} 0 1 0 ${POINT_RADIUS * 2} 0a${POINT_RADIUS} ${POINT_RADIUS} 0 1 0 ${-POINT_RADIUS * 2} 0`;
}

function triangleColorIndex(i0: number, i1: number, i2: number): number {
  return (i0 * 17 + i1 * 31 + i2 * 43) % DEMO_STYLE.trianglePalette.length;
}

function coordinate(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
