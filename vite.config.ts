import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    outDir: "out/renderer",
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "out/**", "release/**", "tests/electron/**"],
    setupFiles: "./src/test/setup.ts",
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
}));
