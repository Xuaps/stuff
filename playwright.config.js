import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  webServer: {
    command: "node test/e2e/server.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
});
