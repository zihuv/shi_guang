import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as {
  dependencies?: Record<string, string>;
};

const dependencies = Object.keys(pkg.dependencies ?? {});
const escapedDependencies = dependencies.map((dependency) =>
  dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);
const externalDependencies = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  ...dependencies,
  new RegExp(`^(${escapedDependencies.join("|")})/.+`),
];

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: {
          main: path.resolve(__dirname, "electron/main.ts"),
          "visual-index-utility": path.resolve(__dirname, "electron/visual-index-utility.ts"),
        },
        formats: ["cjs"],
        fileName: (_format, entryName) => `${entryName}.cjs`,
      },
      rollupOptions: {
        external: externalDependencies,
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: path.resolve(__dirname, "electron/preload.ts"),
        formats: ["cjs"],
      },
      rollupOptions: {
        external: externalDependencies,
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    clearScreen: false,
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: path.resolve(__dirname, "index.html"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 1420,
      strictPort: true,
    },
  },
});
