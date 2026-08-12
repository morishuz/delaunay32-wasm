import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const localFileBuild = mode === "local-file";
  return {
    root: directory,
    base: "./",
    plugins: localFileBuild ? [localFileEntry()] : [],
    resolve: {
      alias: {
        delaunay32: path.resolve(directory, "../../dist/index.js"),
      },
    },
    server: {
      fs: { allow: [path.resolve(directory, "../..")] },
    },
    build: {
      outDir: localFileBuild ? "file-dist" : "dist",
      emptyOutDir: true,
    },
  };
});

function localFileEntry(): Plugin {
  return {
    name: "delaunay32-local-file-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace("./main.ts", "./file-main.ts");
      },
    },
  };
}
