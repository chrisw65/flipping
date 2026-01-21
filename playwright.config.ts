import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "packages/frontend/tests/e2e",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 720 }
  }
});
