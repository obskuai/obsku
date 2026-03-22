import { expect, test, describe, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "../../src/frontend/components/layout/Layout";
import App from "../../src/frontend/App";

describe("Layout and Routing", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders Sidebar inside Layout", () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );
    expect(screen.getAllByText("Obsku Studio").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agents").length).toBeGreaterThan(0);
  });

  test("App renders correctly", () => {
    render(<App />);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });
});
