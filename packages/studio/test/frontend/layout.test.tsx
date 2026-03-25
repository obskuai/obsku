import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof document === "undefined") { try { GlobalRegistrator.register(); } catch {} }

import { expect, test, describe, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Layout } from "../../src/frontend/components/layout/Layout";
import App from "../../src/frontend/App";

describe("Layout and Routing", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders Sidebar inside Layout", () => {
    const { getAllByText } = render(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>Test Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(getAllByText("Obsku Studio").length).toBeGreaterThan(0);
    expect(getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(getAllByText("Agents").length).toBeGreaterThan(0);
  });

  test("App renders correctly", () => {
    window.location.href = "http://localhost/";
    const { getAllByText } = render(<App />);
    expect(getAllByText("Dashboard").length).toBeGreaterThan(0);
  });
});
