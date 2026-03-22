import { agent } from "@obsku/framework";

export const ignoredTestAgent = agent({
  name: "ignored-test-agent",
  prompt: "ignore me",
});
