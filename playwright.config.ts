import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./frontend/e2e",
  timeout: 45_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true
  },
  webServer: [
    {
      command: "npm run dev -w backend",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "npm run dev -w frontend -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});
