import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("agent pages", () => {
  const agentListPath = resolve(import.meta.dirname, "../../src/frontend/pages/AgentList.tsx");
  const agentDetailPath = resolve(import.meta.dirname, "../../src/frontend/pages/AgentDetail.tsx");
  
  const agentListContent = readFileSync(agentListPath, "utf-8");
  const agentDetailContent = readFileSync(agentDetailPath, "utf-8");

  describe("AgentList", () => {
    it("renders table with mock data", () => {
      expect(agentListContent).toContain("export const MOCK_AGENTS");
      expect(agentListContent).toContain("<Table>");
      expect(agentListContent).toContain("<TableHeader>");
      expect(agentListContent).toContain("<TableBody>");
      expect(agentListContent).toContain("filteredAgents.map");
      expect(agentListContent).toContain("tools");
    });

    it("has search functionality", () => {
      expect(agentListContent).toContain("searchTerm");
      expect(agentListContent).toContain("setSearchTerm");
      expect(agentListContent).toContain("<Input");
      expect(agentListContent).toContain('type="search"');
      expect(agentListContent).toContain("MOCK_AGENTS.filter");
    });
  });

  describe("AgentDetail", () => {
    it("renders agent details and badges", () => {
      expect(agentDetailContent).toContain("useParams");
      expect(agentDetailContent).toContain("MOCK_AGENTS.find");
      expect(agentDetailContent).toContain("agent.prompt");
      expect(agentDetailContent).toContain("<Badge");
      expect(agentDetailContent).toContain("Chat with this agent");
    });

    it("renders tabs for tools and handoffs", () => {
      expect(agentDetailContent).toContain("<Tabs");
      expect(agentDetailContent).toContain("<TabsList");
      expect(agentDetailContent).toContain("<TabsTrigger");
      expect(agentDetailContent).toContain('value="tools"');
      expect(agentDetailContent).toContain('value="handoffs"');
      expect(agentDetailContent).toContain("<TabsContent");
    });
  });
});
