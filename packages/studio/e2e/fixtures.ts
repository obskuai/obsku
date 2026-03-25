import { test as base, expect as baseExpect } from "@playwright/test";

type StudioFixtures = {
  consoleErrors: string[];
};

const chatStream = [
  'event: session\ndata: {"sessionId":"sess_e2e","agentName":"customer-support-bot"}\n\n',
  'event: message\ndata: {"sessionId":"sess_e2e","text":"Mock response from test agent."}\n\n',
  'event: done\ndata: {"sessionId":"sess_e2e","text":"Mock response from test agent."}\n\n',
].join("");

const now = Date.now();

const agentsResponse = {
  success: true,
  agents: [
    {
      name: "customer-support-bot",
      description: "Handles customer support questions",
      toolCount: 3,
    },
    {
      name: "code-reviewer",
      description: "Reviews pull requests and diffs",
      toolCount: 2,
    },
    {
      name: "data-analyst",
      description: "Analyzes business and product metrics",
      toolCount: 4,
    },
  ],
};

const agentDetailResponse = {
  success: true,
  agent: {
    name: "customer-support-bot",
    promptPreview: "You are a helpful customer support agent.",
    tools: [
      { name: "ticket-search", description: "Search support tickets" },
      { name: "refund-policy", description: "Check refund policy" },
    ],
    memory: { type: "buffer", maxMessages: 12 },
    guardrailsCount: { input: 1, output: 1 },
    handoffsCount: 2,
    maxIterations: 8,
    streaming: true,
    toolTimeout: 30000,
    toolConcurrency: 3,
  },
};

const graphDetailResponse = {
  success: true,
  graph: {
    nodes: {
      "Intent Router": {
        id: "Intent Router",
        type: "agent",
        status: "Complete",
        description: "Classifies the incoming user request.",
      },
      "Response Agent": {
        id: "Response Agent",
        type: "agent",
        status: "Running",
        description: "Produces the final response.",
      },
    },
    edges: [{ from: "Intent Router", to: "Response Agent" }],
    backEdges: [],
    executionOrder: ["Intent Router", "Response Agent"],
    entry: "Intent Router",
  },
};

const graphsResponse = {
  success: true,
  graphs: [
    {
      id: "support-graph",
      nodeCount: 2,
      edgeCount: 1,
    },
  ],
};

const sessionsResponse = {
  success: true,
  sessions: [
    {
      id: "sess_1",
      title: "Support conversation",
      createdAt: now - 60_000,
      status: "active",
      messageCount: 3,
      updatedAt: now,
    },
  ],
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
};

const sessionDetailResponse = {
  success: true,
  session: sessionsResponse.sessions[0],
  events: [
    {
      type: "agent.thinking",
      category: "agent",
      timestamp: now,
      agent: "customer-support-bot",
      data: { content: "Thinking..." },
      severity: "info",
      sessionId: "sess_1",
    },
  ],
};

const sessionStream = [
  'data: {"type":"agent.message","category":"agent","timestamp":1700000000000,"agent":"customer-support-bot","data":{"content":"Follow-up event"},"severity":"success","sessionId":"sess_1"}\n\n',
].join("");

export const test = base.extend<StudioFixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];

    const push = (value: string) => {
      errors.push(value);
    };

    const onConsole = (message: { type(): string; text(): string }) => {
      if (message.type() === "error") {
        push(`console: ${message.text()}`);
      }
    };

    const onPageError = (error: Error) => {
      push(`pageerror: ${error.message}`);
    };

    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
        body: chatStream,
      });
    });

    await page.route("**/api/agents", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agentsResponse),
      });
    });

    await page.route("**/api/agents/customer-support-bot", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agentDetailResponse),
      });
    });

    await page.route("**/api/graphs/support-graph", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(graphDetailResponse),
      });
    });

    await page.route("**/api/graphs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(graphsResponse),
      });
    });

    await page.route("**/api/sessions?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionsResponse),
      });
    });

    await page.route("**/api/sessions/sess_1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionDetailResponse),
      });
    });

    await page.route("**/api/events?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
        body: sessionStream,
      });
    });

    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    await use(errors);

    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  },
});

export const expect = baseExpect;

export async function expectPageReady(
  routePath: string,
  page: { goto(url: string): Promise<unknown> }
) {
  await page.goto(routePath);
}

export function expectNoBrowserErrors(consoleErrors: string[]) {
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
}
