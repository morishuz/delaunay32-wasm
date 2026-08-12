declare module "*.mjs" {
  const moduleFactory: (options?: Record<string, unknown>) => Promise<unknown>;
  export default moduleFactory;
}

