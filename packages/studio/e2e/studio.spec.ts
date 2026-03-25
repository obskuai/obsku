import { expect, expectNoBrowserErrors, expectPageReady, test } from "./fixtures";

test.describe("studio e2e", () => {
  test("starts the studio app", async ({ page, consoleErrors }) => {
    await expectPageReady("/", page);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expectNoBrowserErrors(consoleErrors);
  });

  test("loads all main routes without browser errors", async ({ page, consoleErrors }) => {
    const routeAssertions = [
      { path: "/", locator: page.getByRole("heading", { name: "Dashboard" }) },
      { path: "/agents", locator: page.getByRole("heading", { name: "Agents" }) },
      {
        path: "/agents/customer-support-bot",
        locator: page.getByRole("heading", { name: "customer-support-bot" }),
      },
      { path: "/graphs", locator: page.getByRole("heading", { name: "Graphs" }) },
      {
        path: "/graphs/support-graph",
        locator: page.getByLabel("Execution graph"),
      },
      { path: "/sessions", locator: page.getByRole("heading", { name: "Sessions" }) },
      {
        path: "/sessions/sess_1",
        locator: page.getByRole("heading", { name: "Session sess_1" }),
      },
      { path: "/chat", locator: page.getByRole("heading", { name: "Chat" }) },
    ];

    for (const route of routeAssertions) {
      await expectPageReady(route.path, page);
      await expect(route.locator).toBeVisible();
    }

    expectNoBrowserErrors(consoleErrors);
  });

  test("renders agent list and supports filtering", async ({ page, consoleErrors }) => {
    await expectPageReady("/agents", page);

    await expect(page.getByRole("link", { name: "customer-support-bot" })).toBeVisible();
    await expect(page.getByRole("link", { name: "code-reviewer" })).toBeVisible();

    await page.getByPlaceholder("Search agents...").fill("analyst");

    await expect(page.getByRole("link", { name: "data-analyst" })).toBeVisible();
    await expect(page.getByText("customer-support-bot")).toHaveCount(0);
    expectNoBrowserErrors(consoleErrors);
  });

  test("renders graph visualization", async ({ page, consoleErrors }) => {
    await expectPageReady("/graphs/support-graph", page);

    await expect(page.getByLabel("Execution graph")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Graph support-graph" })).toBeVisible();
    await expect(page.getByText("Intent Router").first()).toBeVisible();
    await expect(page.getByText("Response Agent").first()).toBeVisible();
    expectNoBrowserErrors(consoleErrors);
  });

  test("loads chat interface and streams mocked response", async ({ page, consoleErrors }) => {
    await expectPageReady("/chat", page);

    await expect(page.getByLabel("Agent")).toBeVisible();
    await expect(page.getByPlaceholder("Ask your agent for help...")).toBeVisible();

    await page.getByPlaceholder("Ask your agent for help...").fill("Hello from Playwright");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText("Mock response from test agent.")).toBeVisible();
    await expect(page.getByText("Session: sess_e2e")).toBeVisible();
    expectNoBrowserErrors(consoleErrors);
  });
});
