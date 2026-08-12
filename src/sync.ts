import { Delaunay32Error } from "./errors.js";
import type { EmscriptenModule } from "./emscripten.js";
import {
  copyInt32FromWasm,
  copyUint32FromWasm,
  readCString,
  WasmMemoryScope,
} from "./memory.js";
import type {
  FloatingPointArray,
  FullTriangulationResult,
  QuantizationOptions,
  QuantizationReport,
  QuantizationResult,
  SampledFullTriangulationResult,
  SampledTriangleOnlyResult,
  SampledTriangulationInput,
  SampledTriangulationResult,
  SamplingPipelineReport,
  TriangleOnlyResult,
  TriangulationInput,
  TriangulationReport,
  TriangulationResult,
} from "./types.js";
import {
  flattenPolygons,
  normalizeQuantizationOptions,
  normalizeSamplingOptions,
  validateConstraints,
  validateQuantizationPoints,
  validateTriangulationPoints,
} from "./validation.js";

interface FullTopology {
  triangles: Uint32Array;
  halfedges: Int32Array;
  hull: Uint32Array;
  representatives: Uint32Array;
}

export class Delaunay32 {
  #module: EmscriptenModule;
  #handle: number;

  constructor(module: EmscriptenModule) {
    this.#module = module;
    this.#handle = module._d32_create();
    if (this.#handle === 0) {
      throw new Delaunay32Error(
        "out-of-memory",
        "Unable to create the Delaunay32 WebAssembly context.",
      );
    }
  }

  triangulate(
    input: TriangulationInput & { resultDetail: "full" },
  ): FullTriangulationResult;
  triangulate(
    input: TriangulationInput & { resultDetail?: "triangles" },
  ): TriangleOnlyResult;
  triangulate(input: TriangulationInput): TriangulationResult;
  triangulate(input: TriangulationInput): TriangulationResult {
    const handle = this.#requireHandle();
    const pointCount = validateTriangulationPoints(input.points);
    this.#setPoints(input, pointCount);
    this.#setConstraints(validateConstraints(input.constraints));
    this.#setPolygons(input.polygons);

    const full = input.resultDetail === "full";
    this.#checkStatus(this.#module._d32_triangulate(handle, full ? 1 : 0));

    const report = this.#readTriangulationReport();
    const reportExtension =
      input.points instanceof Int32Array
        ? {}
        : { quantizationReport: this.#readQuantizationReport() };
    if (!full) {
      return {
        detail: "triangles",
        triangles: this.#readTriangles(),
        report,
        ...reportExtension,
      };
    }
    return {
      detail: "full",
      ...this.#readFullTopology(),
      report,
      ...reportExtension,
    };
  }

  sampleAndTriangulate(
    input: SampledTriangulationInput & { resultDetail: "full" },
  ): SampledFullTriangulationResult;
  sampleAndTriangulate(
    input: SampledTriangulationInput & { resultDetail?: "triangles" },
  ): SampledTriangleOnlyResult;
  sampleAndTriangulate(
    input: SampledTriangulationInput,
  ): SampledTriangulationResult;
  sampleAndTriangulate(
    input: SampledTriangulationInput,
  ): SampledTriangulationResult {
    const handle = this.#requireHandle();
    const boundaryPointCount = validateQuantizationPoints(
      input.boundaryPoints,
    );
    const sampling = normalizeSamplingOptions(
      input.sampling,
      boundaryPointCount,
    );
    const quantization = normalizeQuantizationOptions(input.quantization);
    const flat = flattenPolygons(input.polygons);
    if (flat.domainOffsets.length < 2) {
      throw new Delaunay32Error(
        "invalid-input",
        "Sampled triangulation requires at least one polygon domain.",
      );
    }

    const memory = new WasmMemoryScope(this.#module);
    const full = input.resultDetail === "full";
    try {
      const coordinates = memory.copy(input.boundaryPoints);
      const indices = memory.copy(flat.indices);
      const ringOffsets = memory.copy(flat.ringOffsets);
      const domainOffsets = memory.copy(flat.domainOffsets);
      const operation =
        input.boundaryPoints instanceof Float32Array
          ? this.#module._d32_sample_triangulate_f32
          : this.#module._d32_sample_triangulate_f64;
      this.#checkStatus(
        operation(
          handle,
          coordinates,
          boundaryPointCount,
          indices,
          flat.indices.length,
          ringOffsets,
          flat.ringOffsets.length - 1,
          domainOffsets,
          flat.domainOffsets.length - 1,
          sampling.mode,
          sampling.pointCount,
          sampling.seed,
          sampling.jitter,
          sampling.candidatesPerPoint,
          sampling.attemptsPerPoint,
          quantization.mode,
          quantization.gridStep,
          quantization.originX,
          quantization.originY,
          quantization.scale,
          quantization.maximumError,
          quantization.collisionPolicy,
          full ? 1 : 0,
        ),
      );
    } finally {
      memory.dispose();
    }

    const points = copyInt32FromWasm(
      this.#module,
      this.#module._d32_quantized_points_data(handle),
      this.#module._d32_quantized_points_size(handle),
    );
    const extension = {
      points,
      report: this.#readTriangulationReport(),
      quantizationReport: this.#readQuantizationReport(),
      pipelineReport: this.#readSamplingPipelineReport(),
    };
    if (!full) {
      return {
        detail: "triangles",
        triangles: this.#readTriangles(),
        ...extension,
      };
    }
    return {
      detail: "full",
      ...this.#readFullTopology(),
      ...extension,
    };
  }

  quantize(
    points: FloatingPointArray,
    options?: QuantizationOptions,
  ): QuantizationResult {
    const handle = this.#requireHandle();
    const pointCount = validateQuantizationPoints(points);
    const native = normalizeQuantizationOptions(options);
    const memory = new WasmMemoryScope(this.#module);
    try {
      const pointer = memory.copy(points);
      const operation =
        points instanceof Float32Array
          ? this.#module._d32_quantize_f32
          : this.#module._d32_quantize_f64;
      this.#checkStatus(
        operation(
          handle,
          pointer,
          pointCount,
          native.mode,
          native.gridStep,
          native.originX,
          native.originY,
          native.scale,
          native.maximumError,
          native.collisionPolicy,
        ),
      );
    } finally {
      memory.dispose();
    }
    return {
      points: copyInt32FromWasm(
        this.#module,
        this.#module._d32_quantized_points_data(handle),
        this.#module._d32_quantized_points_size(handle),
      ),
      report: this.#readQuantizationReport(),
    };
  }

  dispose(): void {
    if (this.#handle !== 0) {
      this.#module._d32_destroy(this.#handle);
      this.#handle = 0;
    }
  }

  #setPoints(input: TriangulationInput, pointCount: number): void {
    const handle = this.#requireHandle();
    if (input.points instanceof Int32Array && input.quantization !== undefined) {
      throw new Delaunay32Error(
        "invalid-input",
        "Quantization options cannot be used with Int32Array points.",
      );
    }
    const memory = new WasmMemoryScope(this.#module);
    try {
      const pointer = memory.copy(input.points);
      if (input.points instanceof Int32Array) {
        this.#checkStatus(
          this.#module._d32_set_points_i32(
            handle,
            pointer,
            pointCount,
          ),
        );
        return;
      }
      const native = normalizeQuantizationOptions(input.quantization);
      const operation =
        input.points instanceof Float32Array
          ? this.#module._d32_set_points_f32
          : this.#module._d32_set_points_f64;
      this.#checkStatus(
        operation(
          handle,
          pointer,
          pointCount,
          native.mode,
          native.gridStep,
          native.originX,
          native.originY,
          native.scale,
          native.maximumError,
          native.collisionPolicy,
        ),
      );
    } finally {
      memory.dispose();
    }
  }

  #setConstraints(constraints: Uint32Array): void {
    const memory = new WasmMemoryScope(this.#module);
    try {
      this.#checkStatus(
        this.#module._d32_set_constraints(
          this.#requireHandle(),
          memory.copy(constraints),
          constraints.length / 2,
        ),
      );
    } finally {
      memory.dispose();
    }
  }

  #setPolygons(polygons: TriangulationInput["polygons"]): void {
    const flat = flattenPolygons(polygons);
    const memory = new WasmMemoryScope(this.#module);
    try {
      const indices = memory.copy(flat.indices);
      const ringOffsets = memory.copy(flat.ringOffsets);
      const domainOffsets = memory.copy(flat.domainOffsets);
      const ringCount = flat.ringOffsets.length === 0
        ? 0
        : flat.ringOffsets.length - 1;
      const domainCount = flat.domainOffsets.length === 0
        ? 0
        : flat.domainOffsets.length - 1;
      this.#checkStatus(
        this.#module._d32_set_polygons(
          this.#requireHandle(),
          indices,
          flat.indices.length,
          ringOffsets,
          ringCount,
          domainOffsets,
          domainCount,
        ),
      );
    } finally {
      memory.dispose();
    }
  }

  #readTriangulationReport(): TriangulationReport {
    const handle = this.#requireHandle();
    const predicate = this.#module._d32_report_predicate_width(handle);
    if (predicate !== 0 && predicate !== 1) {
      throw new Delaunay32Error(
        "internal",
        "The WebAssembly module returned an unsupported predicate width after a successful run.",
      );
    }
    return {
      predicateWidth: predicate === 0 ? "int64" : "int128",
      actualThreadCount:
        this.#module._d32_report_actual_thread_count(handle),
      inputPoints: this.#module._d32_report_input_points(handle),
      uniquePoints: this.#module._d32_report_unique_points(handle),
      collapsedPoints: this.#module._d32_report_collapsed_points(handle),
    };
  }

  #readTriangles(): Uint32Array {
    const handle = this.#requireHandle();
    return copyUint32FromWasm(
      this.#module,
      this.#module._d32_triangles_data(handle),
      this.#module._d32_triangles_size(handle),
    );
  }

  #readFullTopology(): FullTopology {
    const handle = this.#requireHandle();
    return {
      triangles: this.#readTriangles(),
      halfedges: copyInt32FromWasm(
        this.#module,
        this.#module._d32_halfedges_data(handle),
        this.#module._d32_halfedges_size(handle),
      ),
      hull: copyUint32FromWasm(
        this.#module,
        this.#module._d32_hull_data(handle),
        this.#module._d32_hull_size(handle),
      ),
      representatives: copyUint32FromWasm(
        this.#module,
        this.#module._d32_representatives_data(handle),
        this.#module._d32_representatives_size(handle),
      ),
    };
  }

  #readQuantizationReport(): QuantizationReport {
    const handle = this.#requireHandle();
    return {
      originX: this.#module._d32_quantization_origin_x(handle),
      originY: this.#module._d32_quantization_origin_y(handle),
      scale: this.#module._d32_quantization_scale(handle),
      gridStep: this.#module._d32_quantization_grid_step(handle),
      maxCoordinateError:
        this.#module._d32_quantization_max_coordinate_error(handle),
      uniquePoints: this.#module._d32_quantization_unique_points(handle),
      collapsedPoints:
        this.#module._d32_quantization_collapsed_points(handle),
    };
  }

  #readSamplingPipelineReport(): SamplingPipelineReport {
    const handle = this.#requireHandle();
    return {
      boundaryPoints: this.#module._d32_pipeline_boundary_points(handle),
      generatedPoints: this.#module._d32_pipeline_generated_points(handle),
      samplingMilliseconds:
        this.#module._d32_pipeline_sampling_milliseconds(handle),
      quantizationMilliseconds:
        this.#module._d32_pipeline_quantization_milliseconds(handle),
      triangulationMilliseconds:
        this.#module._d32_pipeline_triangulation_milliseconds(handle),
    };
  }

  #checkStatus(status: number): void {
    if (status === 0) return;
    const handle = this.#requireHandle();
    const code = this.#module._d32_error_code(handle);
    const message = readCString(
      this.#module,
      this.#module._d32_error_message(handle),
    );
    switch (code) {
      case 1:
        throw new Delaunay32Error("invalid-input", message);
      case 2:
        throw new Delaunay32Error("out-of-memory", message);
      default:
        throw new Delaunay32Error("internal", message);
    }
  }

  #requireHandle(): number {
    if (this.#handle === 0) {
      throw new Delaunay32Error(
        "disposed",
        "This Delaunay32 instance has been disposed.",
      );
    }
    return this.#handle;
  }
}
