import {
  DEMO_STYLE,
  type RenderOptions,
  type ViewBounds,
} from "./rendering.js";

// Keeping the point and triangle arrays in integer textures avoids expanding
// every indexed triangle into JavaScript vertex data. That matters at the
// demo's 100,000-point limit; the shaders reconstruct vertices by index.

const TRIANGLE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform highp isampler2D u_points;
uniform highp usampler2D u_triangles;
uniform ivec2 u_point_texture_size;
uniform ivec2 u_triangle_texture_size;
uniform vec2 u_view_min;
uniform vec2 u_view_size;

flat out uint v_color_index;
out vec3 v_barycentric;

ivec2 texture_coordinate(int index, ivec2 size) {
  return ivec2(index % size.x, index / size.x);
}

vec4 clip_position(ivec2 point) {
  vec2 normalized = (vec2(point) - u_view_min) / u_view_size;
  return vec4(normalized.x * 2.0 - 1.0, normalized.y * 2.0 - 1.0, 0.0, 1.0);
}

void main() {
  int triangle_index = gl_VertexID / 3;
  int corner = gl_VertexID - triangle_index * 3;
  uvec3 indices = texelFetch(
    u_triangles,
    texture_coordinate(triangle_index, u_triangle_texture_size),
    0
  ).rgb;
  uint point_index = corner == 0 ? indices.r : (corner == 1 ? indices.g : indices.b);
  ivec2 point = texelFetch(
    u_points,
    texture_coordinate(int(point_index), u_point_texture_size),
    0
  ).rg;

  gl_Position = clip_position(point);
  v_color_index = (indices.r * 17u + indices.g * 31u + indices.b * 43u) % 5u;
  v_barycentric = corner == 0
    ? vec3(1.0, 0.0, 0.0)
    : (corner == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
}
`;

const TRIANGLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform bool u_fill;
uniform bool u_edges;

flat in uint v_color_index;
in vec3 v_barycentric;
out vec4 out_color;

vec3 palette(uint index) {
  if (index == 0u) return ${glslColor(DEMO_STYLE.trianglePalette[0])};
  if (index == 1u) return ${glslColor(DEMO_STYLE.trianglePalette[1])};
  if (index == 2u) return ${glslColor(DEMO_STYLE.trianglePalette[2])};
  if (index == 3u) return ${glslColor(DEMO_STYLE.trianglePalette[3])};
  return ${glslColor(DEMO_STYLE.trianglePalette[4])};
}

void main() {
  float edge_distance = min(v_barycentric.x, min(v_barycentric.y, v_barycentric.z));
  float antialias = max(fwidth(edge_distance) * 0.72, 0.0001);
  float edge_alpha = 1.0 - smoothstep(0.0, antialias, edge_distance);
  if (!u_fill && (!u_edges || edge_alpha <= 0.0)) discard;

  vec3 fill_color = palette(v_color_index);
  vec3 edge_color = ${glslColor(DEMO_STYLE.triangleEdge)};
  vec3 color = u_edges ? mix(fill_color, edge_color, edge_alpha) : fill_color;
  float alpha = u_fill ? 1.0 : edge_alpha;
  out_color = vec4(color, alpha);
}
`;

const POINT_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform highp isampler2D u_points;
uniform ivec2 u_point_texture_size;
uniform vec2 u_view_min;
uniform vec2 u_view_size;
uniform int u_point_offset;
uniform float u_point_size;

ivec2 texture_coordinate(int index, ivec2 size) {
  return ivec2(index % size.x, index / size.x);
}

void main() {
  int point_index = u_point_offset + gl_VertexID;
  ivec2 point = texelFetch(
    u_points,
    texture_coordinate(point_index, u_point_texture_size),
    0
  ).rg;
  vec2 normalized = (vec2(point) - u_view_min) / u_view_size;
  gl_Position = vec4(normalized.x * 2.0 - 1.0, normalized.y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = u_point_size;
}
`;

const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 out_color;

void main() {
  float radius = length(gl_PointCoord * 2.0 - 1.0);
  float alpha = 1.0 - smoothstep(0.72, 1.0, radius);
  if (alpha <= 0.0) discard;
  out_color = vec4(${glslColor(DEMO_STYLE.point)}, alpha * ${DEMO_STYLE.pointOpacity});
}
`;

export class WebGLMeshRenderer {
  readonly #gl: WebGL2RenderingContext;
  readonly #triangleProgram: WebGLProgram;
  readonly #pointProgram: WebGLProgram;
  readonly #maximumTextureSize: number;
  readonly #textureRowWidth: number;
  readonly #bounds: ViewBounds;
  readonly #boundaryPointCount: number;
  #pointTexture: TextureStorage | undefined;
  #triangleTexture: TextureStorage | undefined;

  constructor(
    canvas: HTMLCanvasElement,
    bounds: ViewBounds,
    boundaryPointCount: number,
  ) {
    this.#bounds = bounds;
    this.#boundaryPointCount = boundaryPointCount;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: true,
    });
    if (gl === null) {
      throw new Error("This demo requires WebGL 2.");
    }
    this.#gl = gl;
    this.#maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.#textureRowWidth = Math.min(this.#maximumTextureSize, 4_096);
    this.#triangleProgram = createProgram(
      gl,
      TRIANGLE_VERTEX_SHADER,
      TRIANGLE_FRAGMENT_SHADER,
    );
    this.#pointProgram = createProgram(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  draw(
    points: Int32Array,
    triangles: Uint32Array,
    options: RenderOptions,
    pixelRatio: number,
  ): void {
    const gl = this.#gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pointUpload = this.#uploadPoints(points);
    if ((options.fill || options.triangleEdges) && triangles.length > 0) {
      const triangleUpload = this.#uploadTriangles(triangles);
      gl.useProgram(this.#triangleProgram);
      this.#setViewUniforms(this.#triangleProgram);
      gl.uniform1i(this.#uniform(this.#triangleProgram, "u_points"), 0);
      gl.uniform1i(this.#uniform(this.#triangleProgram, "u_triangles"), 1);
      gl.uniform2i(
        this.#uniform(this.#triangleProgram, "u_point_texture_size"),
        pointUpload.width,
        pointUpload.height,
      );
      gl.uniform2i(
        this.#uniform(this.#triangleProgram, "u_triangle_texture_size"),
        triangleUpload.width,
        triangleUpload.height,
      );
      gl.uniform1i(this.#uniform(this.#triangleProgram, "u_fill"), options.fill ? 1 : 0);
      gl.uniform1i(
        this.#uniform(this.#triangleProgram, "u_edges"),
        options.triangleEdges ? 1 : 0,
      );
      gl.drawArrays(gl.TRIANGLES, 0, triangles.length);
    }

    const interiorPointCount = Math.max(0, points.length / 2 - this.#boundaryPointCount);
    if (options.nodes || options.polygonNodes) {
      gl.useProgram(this.#pointProgram);
      this.#setViewUniforms(this.#pointProgram);
      gl.uniform1i(this.#uniform(this.#pointProgram, "u_points"), 0);
      gl.uniform2i(
        this.#uniform(this.#pointProgram, "u_point_texture_size"),
        pointUpload.width,
        pointUpload.height,
      );
      gl.uniform1f(
        this.#uniform(this.#pointProgram, "u_point_size"),
        Math.max(2.2, pixelRatio * 1.8),
      );
      if (options.nodes && interiorPointCount > 0) {
        gl.uniform1i(
          this.#uniform(this.#pointProgram, "u_point_offset"),
          this.#boundaryPointCount,
        );
        gl.drawArrays(gl.POINTS, 0, interiorPointCount);
      }
      if (options.polygonNodes && this.#boundaryPointCount > 0) {
        gl.uniform1i(this.#uniform(this.#pointProgram, "u_point_offset"), 0);
        gl.drawArrays(gl.POINTS, 0, this.#boundaryPointCount);
      }
    }

  }

  #setViewUniforms(program: WebGLProgram): void {
    const gl = this.#gl;
    gl.uniform2f(
      this.#uniform(program, "u_view_min"),
      this.#bounds.minX,
      this.#bounds.minY,
    );
    gl.uniform2f(
      this.#uniform(program, "u_view_size"),
      this.#bounds.maxX - this.#bounds.minX,
      this.#bounds.maxY - this.#bounds.minY,
    );
  }

  #uploadPoints(data: Int32Array): TextureStorage {
    const gl = this.#gl;
    const requiredRows = this.#requiredRows(data.length / 2);
    this.#pointTexture = this.#prepareTexture(
      this.#pointTexture,
      0,
      requiredRows,
      gl.RG32I,
      gl.RG_INTEGER,
      gl.INT,
    );
    const expectedLength = this.#pointTexture.width * requiredRows * 2;
    const upload = expectedLength === data.length ? data : paddedInt32(data, expectedLength);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.#pointTexture.width,
      requiredRows,
      gl.RG_INTEGER,
      gl.INT,
      upload,
    );
    return this.#pointTexture;
  }

  #uploadTriangles(data: Uint32Array): TextureStorage {
    const gl = this.#gl;
    const requiredRows = this.#requiredRows(data.length / 3);
    this.#triangleTexture = this.#prepareTexture(
      this.#triangleTexture,
      1,
      requiredRows,
      gl.RGB32UI,
      gl.RGB_INTEGER,
      gl.UNSIGNED_INT,
    );
    const expectedLength = this.#triangleTexture.width * requiredRows * 3;
    const upload = expectedLength === data.length ? data : paddedUint32(data, expectedLength);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.#triangleTexture.width,
      requiredRows,
      gl.RGB_INTEGER,
      gl.UNSIGNED_INT,
      upload,
    );
    return this.#triangleTexture;
  }

  #requiredRows(itemCount: number): number {
    const rows = Math.max(1, Math.ceil(itemCount / this.#textureRowWidth));
    if (rows > this.#maximumTextureSize) {
      throw new Error("Mesh exceeds this GPU's maximum texture dimensions.");
    }
    return rows;
  }

  #prepareTexture(
    storage: TextureStorage | undefined,
    unit: number,
    requiredRows: number,
    internalFormat: number,
    format: number,
    type: number,
  ): TextureStorage {
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (storage === undefined) {
      storage = {
        texture: this.#createTexture(),
        width: this.#textureRowWidth,
        height: 0,
      };
    } else {
      gl.bindTexture(gl.TEXTURE_2D, storage.texture);
    }
    if (storage.height < requiredRows) {
      storage.height = grownTextureHeight(requiredRows, this.#maximumTextureSize);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internalFormat,
        storage.width,
        storage.height,
        0,
        format,
        type,
        null,
      );
    }
    return storage;
  }

  #createTexture(): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    if (texture === null) throw new Error("Unable to allocate a GPU texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  #uniform(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.#gl.getUniformLocation(program, name);
    if (location === null) throw new Error(`Missing WebGL uniform ${name}.`);
    return location;
  }
}

interface TextureStorage {
  texture: WebGLTexture;
  width: number;
  height: number;
}

function glslColor(hex: `#${string}`): string {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return `vec3(${red.toFixed(3)}, ${green.toFixed(3)}, ${blue.toFixed(3)})`;
}

function grownTextureHeight(required: number, maximum: number): number {
  let height = 1;
  while (height < required && height < maximum) height *= 2;
  return Math.min(height, maximum);
}

function paddedInt32(source: Int32Array, length: number): Int32Array {
  const padded = new Int32Array(length);
  padded.set(source);
  return padded;
}

function paddedUint32(source: Uint32Array, length: number): Uint32Array {
  const padded = new Uint32Array(length);
  padded.set(source);
  return padded;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (program === null) throw new Error("Unable to create a WebGL program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Unable to link WebGL.");
  }
  return program;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Unable to create a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Unable to compile WebGL.");
  }
  return shader;
}
