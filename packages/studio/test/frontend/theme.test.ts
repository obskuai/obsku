import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("shadcn/ui theme", () => {
  const globalsPath = resolve(
    import.meta.dirname,
    "../../src/frontend/styles/globals.css"
  );
  const globalsContent = readFileSync(globalsPath, "utf-8");

  it("should have CSS variables defined in :root", () => {
    const requiredVariables = [
      "--background",
      "--foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--destructive-foreground",
      "--border",
      "--input",
      "--ring",
      "--radius",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
    ];

    for (const variable of requiredVariables) {
      expect(globalsContent).toContain(variable);
    }
  });

  it("should have dark mode CSS variables", () => {
    expect(globalsContent).toContain(".dark {");
    expect(globalsContent).toContain("--background:");
  });

  it("should import tailwindcss", () => {
    expect(globalsContent).toContain('@import "tailwindcss"');
  });

  it("should have @theme inline with color mappings", () => {
    expect(globalsContent).toContain("@theme inline");
    expect(globalsContent).toContain("--color-background:");
    expect(globalsContent).toContain("--color-foreground:");
    expect(globalsContent).toContain("--color-primary:");
  });
});

describe("shadcn/ui components", () => {
  it("should have button component", () => {
    const buttonPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/button.tsx"
    );
    const content = readFileSync(buttonPath, "utf-8");
    expect(content).toContain("export { Button");
    expect(content).toContain("buttonVariants");
  });

  it("should have card component", () => {
    const cardPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/card.tsx"
    );
    const content = readFileSync(cardPath, "utf-8");
    expect(content).toContain("export { Card");
    expect(content).toContain("CardHeader");
    expect(content).toContain("CardTitle");
  });

  it("should have badge component", () => {
    const badgePath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/badge.tsx"
    );
    const content = readFileSync(badgePath, "utf-8");
    expect(content).toContain("export { Badge");
    expect(content).toContain("badgeVariants");
  });

  it("should have tabs component", () => {
    const tabsPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/tabs.tsx"
    );
    const content = readFileSync(tabsPath, "utf-8");
    expect(content).toContain("export { Tabs");
    expect(content).toContain("TabsList");
    expect(content).toContain("TabsTrigger");
  });

  it("should have table component", () => {
    const tablePath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/table.tsx"
    );
    const content = readFileSync(tablePath, "utf-8");
    expect(content).toContain("export {");
    expect(content).toContain("Table");
    expect(content).toContain("TableHeader");
    expect(content).toContain("TableRow");
  });

  it("should have dialog component", () => {
    const dialogPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/dialog.tsx"
    );
    const content = readFileSync(dialogPath, "utf-8");
    expect(content).toContain("export {");
    expect(content).toContain("Dialog");
    expect(content).toContain("DialogContent");
    expect(content).toContain("DialogHeader");
  });

  it("should have scroll-area component", () => {
    const scrollAreaPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/scroll-area.tsx"
    );
    const content = readFileSync(scrollAreaPath, "utf-8");
    expect(content).toContain("export { ScrollArea");
    expect(content).toContain("ScrollBar");
  });

  it("should have separator component", () => {
    const separatorPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/separator.tsx"
    );
    const content = readFileSync(separatorPath, "utf-8");
    expect(content).toContain("export { Separator");
  });

  it("should have tooltip component", () => {
    const tooltipPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/tooltip.tsx"
    );
    const content = readFileSync(tooltipPath, "utf-8");
    expect(content).toContain("export { Tooltip");
    expect(content).toContain("TooltipTrigger");
    expect(content).toContain("TooltipContent");
  });

  it("should have sheet component", () => {
    const sheetPath = resolve(
      import.meta.dirname,
      "../../src/frontend/components/ui/sheet.tsx"
    );
    const content = readFileSync(sheetPath, "utf-8");
    expect(content).toContain("export {");
    expect(content).toContain("Sheet");
    expect(content).toContain("SheetContent");
    expect(content).toContain("SheetTrigger");
  });
});

describe("utils", () => {
  it("should have cn utility function", () => {
    const utilsPath = resolve(
      import.meta.dirname,
      "../../src/frontend/lib/utils.ts"
    );
    const content = readFileSync(utilsPath, "utf-8");
    expect(content).toContain("export function cn");
    expect(content).toContain("clsx");
    expect(content).toContain("tailwind-merge");
  });
});
