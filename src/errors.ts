export type Delaunay32ErrorCode =
  | "invalid-input"
  | "out-of-memory"
  | "disposed"
  | "worker-terminated"
  | "internal";

export class Delaunay32Error extends Error {
  readonly code: Delaunay32ErrorCode;

  constructor(code: Delaunay32ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Delaunay32Error";
    this.code = code;
  }
}

