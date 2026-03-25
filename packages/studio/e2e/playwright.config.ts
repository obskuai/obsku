import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const port = 3201;
const baseURL = `http://127.0.0.1:${port}`;
const testDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --config src/frontend/vite.config.ts --host 127.0.0.1 --port ${port} --force`,
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  outputDir: "test-results/playwright",
});
