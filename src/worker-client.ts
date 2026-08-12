import { Delaunay32Error } from "./errors.js";
import type {
  CreateDelaunay32WorkerOptions,
  FloatingPointArray,
  FullTriangulationResult,
  QuantizationOptions,
  QuantizationResult,
  SampledFullTriangulationResult,
  SampledTriangleOnlyResult,
  SampledTriangulationInput,
  SampledTriangulationResult,
  TriangleOnlyResult,
  TriangulationInput,
  TriangulationResult,
  WorkerOperationOptions,
} from "./types.js";
import type {
  WorkerOutboundMessage,
  WorkerQuantizePayload,
  WorkerRequestPayload,
  WorkerRequestMessage,
  WorkerResult,
  WorkerSampleAndTriangulatePayload,
  WorkerTriangulatePayload,
} from "./worker-protocol.js";

interface PendingRequest {
  resolve(value: WorkerResult): void;
  reject(reason: unknown): void;
}

export class Delaunay32Worker {
  readonly worker: Worker;
  #nextId = 1;
  #pending = new Map<number, PendingRequest>();
  #readyResolve!: () => void;
  #readyReject!: (reason: unknown) => void;
  #ready: Promise<void>;
  #terminated = false;
  #terminalError: Delaunay32Error | undefined;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      this.#handleMessage(event.data);
    };
    worker.onerror = (event) => {
      this.#fail(
        new Delaunay32Error(
          "internal",
          event.message || "Delaunay32 worker failed.",
        ),
      );
    };
    worker.onmessageerror = () => {
      this.#fail(
        new Delaunay32Error(
          "internal",
          "Delaunay32 worker returned an unreadable message.",
        ),
      );
    };
  }

  static async create(
    options: CreateDelaunay32WorkerOptions = {},
  ): Promise<Delaunay32Worker> {
    // Keep the default constructor expression static so Vite, Rollup, and
    // Webpack recognize and bundle the complete module-worker dependency graph.
    const worker =
      options.workerUrl === undefined
        ? new Worker(new URL("./worker-runtime.js", import.meta.url), {
            type: "module",
            name: "delaunay32",
          })
        : new Worker(options.workerUrl, {
            type: "module",
            name: "delaunay32",
          });
    const instance = new Delaunay32Worker(worker);
    const initMessage = {
      kind: "init" as const,
      ...(options.wasmUrl === undefined
        ? {}
        : { wasmUrl: options.wasmUrl.toString() }),
    };
    instance.worker.postMessage(initMessage);
    try {
      await instance.#ready;
      return instance;
    } catch (error) {
      instance.terminate();
      throw error;
    }
  }

  triangulate(
    input: TriangulationInput & { resultDetail: "full" },
    options?: WorkerOperationOptions,
  ): Promise<FullTriangulationResult>;
  triangulate(
    input: TriangulationInput & { resultDetail?: "triangles" },
    options?: WorkerOperationOptions,
  ): Promise<TriangleOnlyResult>;
  triangulate(
    input: TriangulationInput,
    options?: WorkerOperationOptions,
  ): Promise<TriangulationResult>;
  triangulate(
    input: TriangulationInput,
    options: WorkerOperationOptions = {},
  ): Promise<TriangulationResult> {
    return this.#request(
      { operation: "triangulate", input },
      options.transferInput === true ? collectInputTransfers(input) : [],
    );
  }

  quantize(
    points: FloatingPointArray,
    quantization?: QuantizationOptions,
    options: WorkerOperationOptions = {},
  ): Promise<QuantizationResult> {
    const request = {
      operation: "quantize" as const,
      points,
      ...(quantization === undefined ? {} : { options: quantization }),
    };
    return this.#request(
      request,
      options.transferInput === true ? transferableBuffers([points]) : [],
    );
  }

  sampleAndTriangulate(
    input: SampledTriangulationInput & { resultDetail: "full" },
    options?: WorkerOperationOptions,
  ): Promise<SampledFullTriangulationResult>;
  sampleAndTriangulate(
    input: SampledTriangulationInput & { resultDetail?: "triangles" },
    options?: WorkerOperationOptions,
  ): Promise<SampledTriangleOnlyResult>;
  sampleAndTriangulate(
    input: SampledTriangulationInput,
    options?: WorkerOperationOptions,
  ): Promise<SampledTriangulationResult>;
  sampleAndTriangulate(
    input: SampledTriangulationInput,
    options: WorkerOperationOptions = {},
  ): Promise<SampledTriangulationResult> {
    return this.#request(
      { operation: "sample-and-triangulate", input },
      options.transferInput === true
        ? collectSampledInputTransfers(input)
        : [],
    );
  }

  terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#terminalError = new Delaunay32Error(
      "worker-terminated",
      "The Delaunay32 worker was terminated.",
    );
    this.worker.terminate();
    this.#rejectPending(this.#terminalError);
  }

  #request(
    request: WorkerTriangulatePayload,
    transfers: Transferable[],
  ): Promise<TriangulationResult>;
  #request(
    request: WorkerQuantizePayload,
    transfers: Transferable[],
  ): Promise<QuantizationResult>;
  #request(
    request: WorkerSampleAndTriangulatePayload,
    transfers: Transferable[],
  ): Promise<SampledTriangulationResult>;
  #request(
    request: WorkerRequestPayload,
    transfers: Transferable[],
  ): Promise<WorkerResult> {
    if (this.#terminated) {
      return Promise.reject(
        this.#terminalError ?? new Delaunay32Error(
          "worker-terminated",
          "The Delaunay32 worker has been terminated.",
        ),
      );
    }
    const id = this.#nextId++;
    const message = createRequestMessage(id, request);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage(message, transfers);
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  #handleMessage(message: WorkerOutboundMessage): void {
    if (message.kind === "ready") {
      this.#readyResolve();
      return;
    }
    if (message.kind === "init-error") {
      this.#readyReject(
        new Delaunay32Error(message.error.code, message.error.message),
      );
      return;
    }
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    this.#pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(
        new Delaunay32Error(message.error.code, message.error.message),
      );
    }
  }

  #rejectPending(error: unknown): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #fail(error: Delaunay32Error): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#terminalError = error;
    this.worker.terminate();
    this.#readyReject(error);
    this.#rejectPending(error);
  }
}

function collectInputTransfers(input: TriangulationInput): Transferable[] {
  const arrays: ArrayBufferView[] = [input.points];
  if (input.constraints !== undefined) arrays.push(input.constraints);
  for (const polygon of input.polygons ?? []) {
    arrays.push(polygon.outerRing, ...(polygon.holes ?? []));
  }
  return transferableBuffers(arrays);
}

function collectSampledInputTransfers(
  input: SampledTriangulationInput,
): Transferable[] {
  const arrays: ArrayBufferView[] = [input.boundaryPoints];
  for (const polygon of input.polygons) {
    arrays.push(polygon.outerRing, ...(polygon.holes ?? []));
  }
  return transferableBuffers(arrays);
}

function transferableBuffers(arrays: readonly ArrayBufferView[]): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const array of arrays) {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
  }
  return [...buffers];
}

function createRequestMessage(
  id: number,
  request: WorkerRequestPayload,
): WorkerRequestMessage {
  switch (request.operation) {
    case "triangulate":
      return {
        kind: "request",
        id,
        operation: request.operation,
        input: request.input,
      };
    case "sample-and-triangulate":
      return {
        kind: "request",
        id,
        operation: request.operation,
        input: request.input,
      };
    case "quantize":
      return {
        kind: "request",
        id,
        operation: request.operation,
        points: request.points,
        ...(request.options === undefined ? {} : { options: request.options }),
      };
  }
}
