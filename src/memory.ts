import { Delaunay32Error } from "./errors.js";
import type { EmscriptenModule } from "./emscripten.js";

export type NumericArray =
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export class WasmMemoryScope {
  readonly #module: EmscriptenModule;
  readonly #pointers: number[] = [];
  #disposed = false;

  constructor(module: EmscriptenModule) {
    this.#module = module;
  }

  copy(source: NumericArray): number {
    if (this.#disposed) {
      throw new Delaunay32Error(
        "internal",
        "Cannot allocate from a disposed WebAssembly memory scope.",
      );
    }
    if (source.byteLength === 0) return 0;
    const pointer = this.#module._malloc(source.byteLength);
    if (pointer === 0) {
      throw new Delaunay32Error(
        "out-of-memory",
        `Unable to allocate ${source.byteLength} bytes in WebAssembly memory.`,
      );
    }
    this.#pointers.push(pointer);
    if (source instanceof Int32Array) {
      this.#module.HEAP32.set(source, pointer >>> 2);
    } else if (source instanceof Uint32Array) {
      this.#module.HEAPU32.set(source, pointer >>> 2);
    } else if (source instanceof Float32Array) {
      this.#module.HEAPF32.set(source, pointer >>> 2);
    } else {
      this.#module.HEAPF64.set(source, pointer >>> 3);
    }
    return pointer;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (let index = this.#pointers.length - 1; index >= 0; index -= 1) {
      this.#module._free(this.#pointers[index] as number);
    }
    this.#pointers.length = 0;
  }
}

export function copyUint32FromWasm(
  module: EmscriptenModule,
  pointer: number,
  length: number,
): Uint32Array {
  if (length === 0) return new Uint32Array();
  assertReadable(pointer, length, "uint32");
  return new Uint32Array(
    module.HEAPU32.subarray(pointer >>> 2, (pointer >>> 2) + length),
  );
}

export function copyInt32FromWasm(
  module: EmscriptenModule,
  pointer: number,
  length: number,
): Int32Array {
  if (length === 0) return new Int32Array();
  assertReadable(pointer, length, "int32");
  return new Int32Array(
    module.HEAP32.subarray(pointer >>> 2, (pointer >>> 2) + length),
  );
}

export function readCString(
  module: EmscriptenModule,
  pointer: number,
): string {
  if (pointer === 0) return "Unknown WebAssembly error.";
  const heap = module.HEAPU8;
  let end = pointer;
  while (end < heap.length && heap[end] !== 0) end += 1;
  return textDecoder.decode(heap.subarray(pointer, end));
}

const textDecoder = new TextDecoder();

function assertReadable(
  pointer: number,
  length: number,
  kind: string,
): void {
  if (pointer === 0) {
    throw new Delaunay32Error(
      "internal",
      `The WebAssembly module returned a null ${kind} result pointer for ${length} values.`,
    );
  }
}
