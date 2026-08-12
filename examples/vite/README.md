# Vite demo

This is the readable source for the interactive Delaunay32 example. Start with
[`main.ts`](main.ts), which creates the worker, then read [`demo.ts`](demo.ts)
for the API call and UI flow.

- `logo.ts` converts the JSON boundary into Delaunay32 typed-array inputs.
- `renderer.ts` is the small public drawing interface used by the demo.
- `webgl-mesh.ts` contains the isolated WebGL implementation needed to draw
  100,000 points without expanding indexed triangles in JavaScript.
- `svg-export.ts` creates the downloadable vector version of the current view.
- `file-main.ts` is used only for the self-contained `file://` build.

From the repository root:

```sh
npm run build
npm run example
```

`npm run example:file` regenerates the root `index.html`. Edit this directory,
not that generated file.
