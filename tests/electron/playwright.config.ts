import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  outputDir: "../../test-results/electron",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
