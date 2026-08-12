import type { PolygonDomain } from "delaunay32";
import logoGeometryJson from "./delaunay32_logo.json";
import type { ViewBounds } from "./rendering.js";

interface RawLogoGeometry {
  points: Array<[number, number]>;
  polygons: Array<{ outer: number[]; holes: number[][] }>;
}

interface LogoGeometry {
  boundaryPoints: Float64Array;
  boundaryPointCount: number;
  polygons: PolygonDomain[];
  rings: Uint32Array[];
  bounds: ViewBounds;
}

// Convert the readable JSON geometry once into the typed arrays expected by
// Delaunay32. Worker calls clone these reusable inputs by default.
export const LOGO = prepareLogoGeometry(logoGeometryJson as RawLogoGeometry);

function prepareLogoGeometry(source: RawLogoGeometry): LogoGeometry {
  const polygons = source.polygons.map((polygon) => ({
    outerRing: new Uint32Array(polygon.outer),
    holes: polygon.holes.map((hole) => new Uint32Array(hole)),
  }));

  return {
    boundaryPoints: new Float64Array(source.points.flat()),
    boundaryPointCount: source.points.length,
    polygons,
    rings: polygons.flatMap((polygon) => [
      polygon.outerRing,
      ...(polygon.holes ?? []),
    ]),
    bounds: geometryBounds(source.points),
  };
}

function geometryBounds(points: readonly [number, number][]): ViewBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}
