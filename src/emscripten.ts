import createDelaunay32Module from "./delaunay32-module.mjs";

export interface EmscriptenModule {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  _malloc(size: number): number;
  _free(pointer: number): void;

  _d32_create(): number;
  _d32_destroy(handle: number): void;
  _d32_set_points_i32(handle: number, data: number, count: number): number;
  _d32_set_points_f32(
    handle: number,
    data: number,
    count: number,
    mode: number,
    gridStep: number,
    originX: number,
    originY: number,
    scale: number,
    maximumError: number,
    collisionPolicy: number,
  ): number;
  _d32_set_points_f64(
    handle: number,
    data: number,
    count: number,
    mode: number,
    gridStep: number,
    originX: number,
    originY: number,
    scale: number,
    maximumError: number,
    collisionPolicy: number,
  ): number;
  _d32_set_constraints(
    handle: number,
    data: number,
    count: number,
  ): number;
  _d32_set_polygons(
    handle: number,
    indices: number,
    indexCount: number,
    ringOffsets: number,
    ringCount: number,
    domainOffsets: number,
    domainCount: number,
  ): number;
  _d32_sample_triangulate_f32(
    handle: number,
    coordinates: number,
    boundaryPointCount: number,
    indices: number,
    indexCount: number,
    ringOffsets: number,
    ringCount: number,
    domainOffsets: number,
    domainCount: number,
    samplingMode: number,
    sampledPointCount: number,
    seed: number,
    jitter: number,
    candidatesPerPoint: number,
    attemptsPerPoint: number,
    quantizationMode: number,
    gridStep: number,
    originX: number,
    originY: number,
    scale: number,
    maximumError: number,
    collisionPolicy: number,
    detail: number,
  ): number;
  _d32_sample_triangulate_f64(
    handle: number,
    coordinates: number,
    boundaryPointCount: number,
    indices: number,
    indexCount: number,
    ringOffsets: number,
    ringCount: number,
    domainOffsets: number,
    domainCount: number,
    samplingMode: number,
    sampledPointCount: number,
    seed: number,
    jitter: number,
    candidatesPerPoint: number,
    attemptsPerPoint: number,
    quantizationMode: number,
    gridStep: number,
    originX: number,
    originY: number,
    scale: number,
    maximumError: number,
    collisionPolicy: number,
    detail: number,
  ): number;
  _d32_triangulate(handle: number, detail: number): number;
  _d32_quantize_f32(
    handle: number,
    data: number,
    count: number,
    mode: number,
    gridStep: number,
    originX: number,
    originY: number,
    scale: number,
    maximumError: number,
    collisionPolicy: number,
  ): number;
  _d32_quantize_f64(
    handle: number,
    data: number,
    count: number,
    mode: number,
    gridStep: number,
    originX: number,
    originY: number,
    scale: number,
    maximumError: number,
    collisionPolicy: number,
  ): number;

  _d32_error_code(handle: number): number;
  _d32_error_message(handle: number): number;
  _d32_triangles_data(handle: number): number;
  _d32_triangles_size(handle: number): number;
  _d32_halfedges_data(handle: number): number;
  _d32_halfedges_size(handle: number): number;
  _d32_hull_data(handle: number): number;
  _d32_hull_size(handle: number): number;
  _d32_representatives_data(handle: number): number;
  _d32_representatives_size(handle: number): number;
  _d32_quantized_points_data(handle: number): number;
  _d32_quantized_points_size(handle: number): number;
  _d32_report_predicate_width(handle: number): number;
  _d32_report_actual_thread_count(handle: number): number;
  _d32_report_input_points(handle: number): number;
  _d32_report_unique_points(handle: number): number;
  _d32_report_collapsed_points(handle: number): number;
  _d32_quantization_origin_x(handle: number): number;
  _d32_quantization_origin_y(handle: number): number;
  _d32_quantization_scale(handle: number): number;
  _d32_quantization_grid_step(handle: number): number;
  _d32_quantization_max_coordinate_error(handle: number): number;
  _d32_quantization_unique_points(handle: number): number;
  _d32_quantization_collapsed_points(handle: number): number;
  _d32_pipeline_boundary_points(handle: number): number;
  _d32_pipeline_generated_points(handle: number): number;
  _d32_pipeline_sampling_milliseconds(handle: number): number;
  _d32_pipeline_quantization_milliseconds(handle: number): number;
  _d32_pipeline_triangulation_milliseconds(handle: number): number;
}

export async function instantiateModule(
  wasmUrl?: string | URL,
): Promise<EmscriptenModule> {
  const options: Record<string, unknown> = {};
  if (wasmUrl !== undefined) {
    const resolved = new URL(
      wasmUrl.toString(),
      typeof location === "undefined" ? import.meta.url : location.href,
    ).href;
    options.locateFile = (file: string, prefix: string) =>
      file.endsWith(".wasm") ? resolved : `${prefix}${file}`;
  }
  return (await createDelaunay32Module(options)) as EmscriptenModule;
}
