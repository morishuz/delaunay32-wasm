import { Delaunay32Error } from "./errors.js";
import type {
  FloatingPointArray,
  PointArray,
  PolygonDomain,
  QuantizationOptions,
  SamplingOptions,
} from "./types.js";

export interface NativeQuantizationOptions {
  mode: 0 | 1 | 2;
  gridStep: number;
  originX: number;
  originY: number;
  scale: number;
  maximumError: number;
  collisionPolicy: 0 | 1;
}

export interface FlatPolygons {
  indices: Uint32Array;
  ringOffsets: Uint32Array;
  domainOffsets: Uint32Array;
}

export interface NativeSamplingOptions {
  mode: 0 | 1 | 2;
  pointCount: number;
  seed: number;
  jitter: number;
  candidatesPerPoint: number;
  attemptsPerPoint: number;
}

export function validateTriangulationPoints(points: PointArray): number {
  validatePointArray(points);
  const count = points.length / 2;
  if (count < 3) {
    invalid("Triangulation requires at least three point entries.");
  }
  if (count > 0xffff_ffff) {
    invalid("Point count exceeds the uint32 index range.");
  }
  return count;
}

export function validateQuantizationPoints(
  points: FloatingPointArray,
): number {
  if (!(points instanceof Float32Array || points instanceof Float64Array)) {
    invalid("Quantization requires a Float32Array or Float64Array.");
  }
  validatePointArray(points);
  const count = points.length / 2;
  if (count < 1) {
    invalid("Quantization requires at least one point.");
  }
  return count;
}

export function validateConstraints(
  constraints: Uint32Array | undefined,
): Uint32Array {
  if (constraints === undefined) return new Uint32Array();
  if (!(constraints instanceof Uint32Array)) {
    invalid("Constraints must be a Uint32Array of endpoint pairs.");
  }
  if (constraints.length % 2 !== 0) {
    invalid("Constraint array length must be even.");
  }
  return constraints;
}

export function flattenPolygons(
  polygons: readonly PolygonDomain[] | undefined,
): FlatPolygons {
  if (polygons === undefined || polygons.length === 0) {
    return {
      indices: new Uint32Array(),
      ringOffsets: new Uint32Array(),
      domainOffsets: new Uint32Array(),
    };
  }
  const rings: Uint32Array[] = [];
  const domainOffsets = [0];
  for (const [domainIndex, polygon] of polygons.entries()) {
    if (polygon === null || typeof polygon !== "object") {
      invalid(`Polygon domain ${domainIndex} is not an object.`);
    }
    validateRing(polygon.outerRing, `Polygon domain ${domainIndex} outer ring`);
    rings.push(polygon.outerRing);
    for (const [holeIndex, hole] of (polygon.holes ?? []).entries()) {
      validateRing(hole, `Polygon domain ${domainIndex} hole ${holeIndex}`);
      rings.push(hole);
    }
    domainOffsets.push(rings.length);
  }

  const ringOffsets = [0];
  let indexCount = 0;
  for (const ring of rings) {
    indexCount += ring.length;
    if (indexCount > 0xffff_ffff) {
      invalid("Polygon index data exceeds the uint32 range.");
    }
    ringOffsets.push(indexCount);
  }
  const indices = new Uint32Array(indexCount);
  let cursor = 0;
  for (const ring of rings) {
    indices.set(ring, cursor);
    cursor += ring.length;
  }
  return {
    indices,
    ringOffsets: new Uint32Array(ringOffsets),
    domainOffsets: new Uint32Array(domainOffsets),
  };
}

export function normalizeQuantizationOptions(
  options: QuantizationOptions | undefined,
): NativeQuantizationOptions {
  if (options !== undefined && (options === null || typeof options !== "object")) {
    invalid("Quantization options must be an object.");
  }
  const selected = options ?? { mode: "automatic" as const };
  let mode: NativeQuantizationOptions["mode"] = 0;
  let gridStep = 0;
  let originX = 0;
  let originY = 0;
  let scale = 0;
  if (selected.mode === "grid-step") {
    mode = 1;
    gridStep = selected.gridStep;
    positiveFinite(gridStep, "Quantization gridStep");
  } else if (selected.mode === "fixed-scale") {
    mode = 2;
    originX = selected.originX;
    originY = selected.originY;
    scale = selected.scale;
    finite(originX, "Fixed-scale originX");
    finite(originY, "Fixed-scale originY");
    positiveFinite(scale, "Fixed-scale scale");
  } else if (selected.mode !== undefined && selected.mode !== "automatic") {
    invalid(`Unknown quantization mode: ${String(selected.mode)}.`);
  }
  if (
    selected.collisionPolicy !== undefined &&
    selected.collisionPolicy !== "allow" &&
    selected.collisionPolicy !== "reject"
  ) {
    invalid(
      `Unknown quantization collision policy: ${String(selected.collisionPolicy)}.`,
    );
  }
  const maximumError = selected.maxCoordinateError ?? 0;
  if (!Number.isFinite(maximumError) || maximumError < 0) {
    invalid("Quantization maxCoordinateError must be finite and nonnegative.");
  }
  return {
    mode,
    gridStep,
    originX,
    originY,
    scale,
    maximumError,
    collisionPolicy: selected.collisionPolicy === "reject" ? 1 : 0,
  };
}

export function normalizeSamplingOptions(
  options: SamplingOptions,
  boundaryPointCount: number,
): NativeSamplingOptions {
  if (options === null || typeof options !== "object") {
    invalid("Sampling options must be an object.");
  }
  const pointCount = positiveInteger(
    options.pointCount,
    "Sampling pointCount",
  );
  if (pointCount + boundaryPointCount > 0xffff_ffff) {
    invalid("Boundary and sampled point count exceeds the uint32 index range.");
  }
  const seed = options.seed ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    invalid("Sampling seed must be an integer between 0 and 4294967295.");
  }

  if (options.mode === "uniform") {
    return {
      mode: 0,
      pointCount,
      seed,
      jitter: 0,
      candidatesPerPoint: 0,
      attemptsPerPoint: positiveInteger(
        options.attemptsPerPoint ?? 10_000,
        "Uniform attemptsPerPoint",
      ),
    };
  }
  if (options.mode === "blue-noise") {
    return {
      mode: 1,
      pointCount,
      seed,
      jitter: 0,
      candidatesPerPoint: positiveInteger(
        options.candidatesPerPoint ?? 16,
        "Blue-noise candidatesPerPoint",
      ),
      attemptsPerPoint: positiveInteger(
        options.attemptsPerCandidate ?? 10_000,
        "Blue-noise attemptsPerCandidate",
      ),
    };
  }
  if (options.mode === "jittered-grid") {
    const jitter = options.jitter ?? 0.75;
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
      invalid("Jittered-grid jitter must be between zero and one.");
    }
    return {
      mode: 2,
      pointCount,
      seed,
      jitter,
      candidatesPerPoint: 0,
      attemptsPerPoint: positiveInteger(
        options.attemptsPerPoint ?? 10_000,
        "Jittered-grid attemptsPerPoint",
      ),
    };
  }
  invalid(`Unknown sampling mode: ${String((options as { mode?: unknown }).mode)}.`);
}

function validatePointArray(points: PointArray): void {
  if (
    !(
      points instanceof Int32Array ||
      points instanceof Float32Array ||
      points instanceof Float64Array
    )
  ) {
    invalid("Points must be an Int32Array, Float32Array, or Float64Array.");
  }
  if (points.length % 2 !== 0) {
    invalid("Point coordinate array length must be even.");
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff) {
    invalid(`${label} must be a positive uint32 integer.`);
  }
  return value;
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    invalid(`${label} must be finite and positive.`);
  }
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    invalid(`${label} must be finite.`);
  }
}

function validateRing(ring: Uint32Array, label: string): void {
  if (!(ring instanceof Uint32Array)) {
    invalid(`${label} must be a Uint32Array.`);
  }
  if (ring.length < 3) {
    invalid(`${label} must contain at least three indices.`);
  }
}

function invalid(message: string): never {
  throw new Delaunay32Error("invalid-input", message);
}
