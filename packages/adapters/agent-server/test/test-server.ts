import type { LLMProvider, LLMResponse, LLMStreamEvent } from "@obsku/framework";
import { serve } from "../src/index";

const port = Number(process.env.PORT ?? "9000");

const provider: LLMProvider = {
  contextWindowSize: 8192,
  async chat(): Promise<LLMResponse> {
    return {
      content: [{ text: "mock response", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
  async *chatStream(): AsyncIterable<LLMStreamEvent> {
    yield { content: "mock", type: "text_delta" };
    yield {
      stopReason: "end_turn",
      type: "message_end",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
};

const testAgent = {
  name: "integration-test-agent",
  run: async (input: string, _provider: LLMProvider): Promise<string> => {
    return `[integration-test] ${input}`;
  },
};

const server = serve(testAgent, provider, {
  description: "Integration test agent for Docker-based A2A testing",
  port,
  skills: ["test", "echo"],
});

process.stdout.write(`Test agent server listening on http://0.0.0.0:${server.port}\n`);

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
