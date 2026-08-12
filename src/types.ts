export type PointArray = Int32Array | Float32Array | Float64Array;
export type FloatingPointArray = Float32Array | Float64Array;

export type CollisionPolicy = "allow" | "reject";

interface QuantizationOptionsCommon {
  maxCoordinateError?: number;
  collisionPolicy?: CollisionPolicy;
}

export interface AutomaticQuantizationOptions
  extends QuantizationOptionsCommon {
  mode?: "automatic";
}

export interface GridStepQuantizationOptions
  extends QuantizationOptionsCommon {
  mode: "grid-step";
  gridStep: number;
}

export interface FixedScaleQuantizationOptions
  extends QuantizationOptionsCommon {
  mode: "fixed-scale";
  originX: number;
  originY: number;
  scale: number;
}

export type QuantizationOptions =
  | AutomaticQuantizationOptions
  | GridStepQuantizationOptions
  | FixedScaleQuantizationOptions;

export interface PolygonDomain {
  outerRing: Uint32Array;
  holes?: readonly Uint32Array[];
}

export interface TriangulationInput {
  points: PointArray;
  constraints?: Uint32Array;
  polygons?: readonly PolygonDomain[];
  resultDetail?: "triangles" | "full";
  quantization?: QuantizationOptions;
}

interface SamplingOptionsCommon {
  pointCount: number;
  seed?: number;
}

export interface UniformSamplingOptions extends SamplingOptionsCommon {
  mode: "uniform";
  attemptsPerPoint?: number;
}

export interface BlueNoiseSamplingOptions extends SamplingOptionsCommon {
  mode: "blue-noise";
  candidatesPerPoint?: number;
  attemptsPerCandidate?: number;
}

export interface JitteredGridSamplingOptions extends SamplingOptionsCommon {
  mode: "jittered-grid";
  jitter?: number;
  attemptsPerPoint?: number;
}

export type SamplingOptions =
  | UniformSamplingOptions
  | BlueNoiseSamplingOptions
  | JitteredGridSamplingOptions;

export interface SampledTriangulationInput {
  boundaryPoints: FloatingPointArray;
  polygons: readonly PolygonDomain[];
  sampling: SamplingOptions;
  resultDetail?: "triangles" | "full";
  quantization?: QuantizationOptions;
}

export interface TriangulationReport {
  predicateWidth: "int64" | "int128";
  actualThreadCount: number;
  inputPoints: number;
  uniquePoints: number;
  collapsedPoints: number;
}

export interface QuantizationReport {
  originX: number;
  originY: number;
  scale: number;
  gridStep: number;
  maxCoordinateError: number;
  uniquePoints: number;
  collapsedPoints: number;
}

export interface SamplingPipelineReport {
  boundaryPoints: number;
  generatedPoints: number;
  samplingMilliseconds: number;
  quantizationMilliseconds: number;
  triangulationMilliseconds: number;
}

export interface TriangleOnlyResult {
  detail: "triangles";
  triangles: Uint32Array;
  report: TriangulationReport;
  quantizationReport?: QuantizationReport;
}

export interface FullTriangulationResult {
  detail: "full";
  triangles: Uint32Array;
  halfedges: Int32Array;
  hull: Uint32Array;
  representatives: Uint32Array;
  report: TriangulationReport;
  quantizationReport?: QuantizationReport;
}

export type TriangulationResult =
  | TriangleOnlyResult
  | FullTriangulationResult;

interface SampledResultExtension {
  points: Int32Array;
  quantizationReport: QuantizationReport;
  pipelineReport: SamplingPipelineReport;
}

export type SampledTriangleOnlyResult = TriangleOnlyResult &
  SampledResultExtension;
export type SampledFullTriangulationResult = FullTriangulationResult &
  SampledResultExtension;
export type SampledTriangulationResult =
  | SampledTriangleOnlyResult
  | SampledFullTriangulationResult;

export interface QuantizationResult {
  points: Int32Array;
  report: QuantizationReport;
}

export interface CreateDelaunay32Options {
  wasmUrl?: string | URL;
}

export interface CreateDelaunay32WorkerOptions extends CreateDelaunay32Options {
  workerUrl?: string | URL;
}

export interface WorkerOperationOptions {
  /** Transfer and detach every input ArrayBuffer instead of cloning it. */
  transferInput?: boolean;
}
