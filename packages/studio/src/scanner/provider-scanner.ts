import { type ImportDeclaration, Node, type SourceFile, SyntaxKind } from "ts-morph";
import type { DetectedProvider } from "../server/provider-adapter.js";
import { createScanProject } from "./common.js";

const AI_SDK_PROVIDER_IDS = ["anthropic", "google", "groq", "openai"] as const;

const PACKAGE_PROVIDER_IDS = new Map<string, readonly string[]>([
  ["@obsku/provider-bedrock", ["bedrock"]],
  ["@obsku/provider-ai-sdk", AI_SDK_PROVIDER_IDS],
  ["@obsku/provider-ollama", []],
]);

export async function detectProviders(cwd: string): Promise<DetectedProvider[]> {
  const project = createScanProject(cwd);
  const detectedPackages = new Map<string, Set<string>>();

  for (const sourceFile of project.getSourceFiles()) {
    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      const packageName = importDeclaration.getModuleSpecifierValue();
      if (!packageName.startsWith("@obsku/provider-")) {
        continue;
      }

      const providerIds = detectProviderIds(sourceFile, importDeclaration);
      if (providerIds.length === 0) {
        continue;
      }

      const detectedProviderIds = detectedPackages.get(packageName) ?? new Set<string>();

      for (const providerId of providerIds) {
        detectedProviderIds.add(providerId);
      }

      detectedPackages.set(packageName, detectedProviderIds);
    }
  }

  return Array.from(detectedPackages.entries())
    .map(([packageName, providerIds]) => ({
      package: packageName,
      providerIds: sortProviderIds(packageName, Array.from(providerIds)),
    }))
    .sort((left, right) => left.package.localeCompare(right.package));
}

function detectProviderIds(sourceFile: SourceFile, importDeclaration: ImportDeclaration): string[] {
  const packageName = importDeclaration.getModuleSpecifierValue();
  const knownProviderIds = PACKAGE_PROVIDER_IDS.get(packageName);
  if (!knownProviderIds || knownProviderIds.length === 0) {
    return [];
  }

  if (packageName !== "@obsku/provider-ai-sdk") {
    return [...knownProviderIds];
  }

  const localFactoryNames = new Map<string, string>();
  for (const namedImport of importDeclaration.getNamedImports()) {
    const providerId = namedImport.getName();
    if (!AI_SDK_PROVIDER_IDS.includes(providerId as (typeof AI_SDK_PROVIDER_IDS)[number])) {
      continue;
    }

    localFactoryNames.set(namedImport.getAliasNode()?.getText() ?? providerId, providerId);
  }

  if (localFactoryNames.size === 0) {
    return [...knownProviderIds];
  }

  const usedProviderIds = new Set<string>();
  for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpression.getExpression();
    if (!Node.isIdentifier(expression)) {
      continue;
    }

    const providerId = localFactoryNames.get(expression.getText());
    if (providerId) {
      usedProviderIds.add(providerId);
    }
  }

  return usedProviderIds.size > 0
    ? sortProviderIds(packageName, Array.from(usedProviderIds))
    : [...knownProviderIds];
}

function sortProviderIds(packageName: string, providerIds: string[]): string[] {
  const order = PACKAGE_PROVIDER_IDS.get(packageName);
  if (!order) {
    return providerIds.sort();
  }

  return [...providerIds].sort(
    (left, right) => order.indexOf(left) - order.indexOf(right) || left.localeCompare(right)
  );
}
