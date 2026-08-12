import type { Delaunay32ErrorCode } from "./errors.js";
import type {
  FloatingPointArray,
  QuantizationOptions,
  QuantizationResult,
  SampledTriangulationInput,
  SampledTriangulationResult,
  TriangulationInput,
  TriangulationResult,
} from "./types.js";

export interface WorkerInitMessage {
  kind: "init";
  wasmUrl?: string;
}

export interface WorkerTriangulateMessage {
  kind: "request";
  id: number;
  operation: "triangulate";
  input: TriangulationInput;
}

export interface WorkerQuantizeMessage {
  kind: "request";
  id: number;
  operation: "quantize";
  points: FloatingPointArray;
  options?: QuantizationOptions;
}

export interface WorkerSampleAndTriangulateMessage {
  kind: "request";
  id: number;
  operation: "sample-and-triangulate";
  input: SampledTriangulationInput;
}

export type WorkerRequestMessage =
  | WorkerTriangulateMessage
  | WorkerQuantizeMessage
  | WorkerSampleAndTriangulateMessage;

export type WorkerTriangulatePayload = Omit<
  WorkerTriangulateMessage,
  "kind" | "id"
>;
export type WorkerQuantizePayload = Omit<
  WorkerQuantizeMessage,
  "kind" | "id"
>;
export type WorkerSampleAndTriangulatePayload = Omit<
  WorkerSampleAndTriangulateMessage,
  "kind" | "id"
>;
export type WorkerRequestPayload =
  | WorkerTriangulatePayload
  | WorkerQuantizePayload
  | WorkerSampleAndTriangulatePayload;

export type WorkerInboundMessage = WorkerInitMessage | WorkerRequestMessage;

export interface WorkerReadyMessage {
  kind: "ready";
}

export type WorkerResult =
  | TriangulationResult
  | QuantizationResult
  | SampledTriangulationResult;

export interface WorkerSuccessMessage {
  kind: "response";
  id: number;
  ok: true;
  result: WorkerResult;
}

export interface WorkerFailureMessage {
  kind: "response";
  id: number;
  ok: false;
  error: {
    code: Delaunay32ErrorCode;
    message: string;
    stack?: string;
  };
}

export interface WorkerInitFailureMessage {
  kind: "init-error";
  error: {
    code: Delaunay32ErrorCode;
    message: string;
    stack?: string;
  };
}

export type WorkerOutboundMessage =
  | WorkerReadyMessage
  | WorkerSuccessMessage
  | WorkerFailureMessage
  | WorkerInitFailureMessage;
