import { instantiateModule } from "./emscripten.js";
import { Delaunay32 } from "./sync.js";
import type {
  CreateDelaunay32Options,
  CreateDelaunay32WorkerOptions,
} from "./types.js";
import { Delaunay32Worker } from "./worker-client.js";

export const version = "0.1.0";
export const coreVersion = "0.6.2";

export async function createDelaunay32(
  options: CreateDelaunay32Options = {},
): Promise<Delaunay32> {
  return new Delaunay32(await instantiateModule(options.wasmUrl));
}

export async function createDelaunay32Worker(
  options: CreateDelaunay32WorkerOptions = {},
): Promise<Delaunay32Worker> {
  return Delaunay32Worker.create(options);
}

export { Delaunay32Error } from "./errors.js";
export type { Delaunay32ErrorCode } from "./errors.js";
export { Delaunay32 } from "./sync.js";
export { Delaunay32Worker } from "./worker-client.js";
export type {
  AutomaticQuantizationOptions,
  CollisionPolicy,
  CreateDelaunay32Options,
  CreateDelaunay32WorkerOptions,
  FixedScaleQuantizationOptions,
  FloatingPointArray,
  FullTriangulationResult,
  GridStepQuantizationOptions,
  PointArray,
  PolygonDomain,
  QuantizationOptions,
  QuantizationReport,
  QuantizationResult,
  BlueNoiseSamplingOptions,
  JitteredGridSamplingOptions,
  SampledFullTriangulationResult,
  SampledTriangleOnlyResult,
  SampledTriangulationInput,
  SampledTriangulationResult,
  SamplingOptions,
  SamplingPipelineReport,
  TriangleOnlyResult,
  TriangulationInput,
  TriangulationReport,
  TriangulationResult,
  UniformSamplingOptions,
  WorkerOperationOptions,
} from "./types.js";
