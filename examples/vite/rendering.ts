export const DEMO_STYLE = {
  trianglePalette: ["#ffefc4", "#aee3ff", "#58d5d5", "#6599af", "#4d466e"],
  triangleEdge: "#35566a",
  polygonOutline: "#34464b",
  point: "#163f52",
  pointOpacity: 0.88,
  lineWidth: 0.55,
  svgLineWidth: 0.12,
} as const;

export interface ViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RenderOptions {
  fill: boolean;
  triangleEdges: boolean;
  nodes: boolean;
  polygonNodes: boolean;
  polygonOutline: boolean;
}

export function paddedBounds(bounds: ViewBounds, ratio: number): ViewBounds {
  const paddingX = (bounds.maxX - bounds.minX) * ratio;
  const paddingY = (bounds.maxY - bounds.minY) * ratio;
  return {
    minX: bounds.minX - paddingX,
    minY: bounds.minY - paddingY,
    maxX: bounds.maxX + paddingX,
    maxY: bounds.maxY + paddingY,
  };
}
