/// <reference lib="webworker" />

import { Delaunay32Error } from "./errors.js";
import { instantiateModule } from "./emscripten.js";
import { Delaunay32 } from "./sync.js";
import type {
  QuantizationResult,
  SampledTriangulationResult,
  TriangulationResult,
} from "./types.js";
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerRequestMessage,
} from "./worker-protocol.js";

const scope = self as DedicatedWorkerGlobalScope;
let api: Delaunay32 | undefined;
let queue = Promise.resolve();

scope.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;
  if (message.kind === "init") {
    queue = queue.then(async () => {
      try {
        api = new Delaunay32(await instantiateModule(message.wasmUrl));
        post({ kind: "ready" });
      } catch (error) {
        post({ kind: "init-error", error: serializeError(error) });
      }
    });
    return;
  }
  queue = queue.then(() => handleRequest(message));
};

function handleRequest(message: WorkerRequestMessage): void {
  if (api === undefined) {
    post({
      kind: "response",
      id: message.id,
      ok: false,
      error: {
        code: "internal",
        message: "Delaunay32 worker received a request before initialization.",
      },
    });
    return;
  }
  try {
    const result = message.operation === "triangulate"
      ? api.triangulate(message.input)
      : message.operation === "sample-and-triangulate"
        ? api.sampleAndTriangulate(message.input)
        : api.quantize(message.points, message.options);
    post(
      { kind: "response", id: message.id, ok: true, result },
      resultTransfers(result),
    );
  } catch (error) {
    post({
      kind: "response",
      id: message.id,
      ok: false,
      error: serializeError(error),
    });
  }
}

function resultTransfers(
  result:
    | TriangulationResult
    | QuantizationResult
    | SampledTriangulationResult,
): Transferable[] {
  if ("detail" in result) {
    const transfers: Transferable[] = [result.triangles.buffer];
    if ("points" in result) transfers.push(result.points.buffer);
    if (result.detail === "full") {
      transfers.push(
        result.halfedges.buffer,
        result.hull.buffer,
        result.representatives.buffer,
      );
    }
    return transfers;
  }
  return [result.points.buffer];
}

function serializeError(error: unknown): {
  code: Delaunay32Error["code"];
  message: string;
  stack?: string;
} {
  const normalized =
    error instanceof Delaunay32Error
      ? error
      : new Delaunay32Error(
          "internal",
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? { cause: error } : undefined,
        );
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.stack === undefined ? {} : { stack: normalized.stack }),
  };
}

function post(message: WorkerOutboundMessage, transfers: Transferable[] = []): void {
  scope.postMessage(message, transfers);
}
