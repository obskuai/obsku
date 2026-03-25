import { Hono } from "hono";
import { loadStudioConfig } from "../../scanner/config-loader.js";
import { detectProviders } from "../../scanner/provider-scanner.js";
import { ProvidersResponseSchema } from "../../shared/schemas.js";
import {
  type DetectedProvider,
  KNOWN_PROVIDERS,
  type ProviderResolution,
  resolveProvider,
} from "../provider-adapter.js";

export interface ProvidersRouteOptions {
  rootDir?: string;
  detectProviders?: (rootDir: string) => Promise<DetectedProvider[]>;
  getProviderResolution?: (
    detectedProviders: DetectedProvider[],
    rootDir: string
  ) => Promise<ProviderResolution>;
}

export function createProvidersRoute(options: ProvidersRouteOptions = {}): Hono {
  const app = new Hono();

  app.get("/providers", async (c) => {
    const rootDir = options.rootDir ?? process.cwd();
    const detectedProviders = await (options.detectProviders ?? detectProviders)(rootDir);
    const providerResolution = await (options.getProviderResolution ?? getProviderResolution)(
      detectedProviders,
      rootDir
    );
    const detectedIds = new Set(detectedProviders.flatMap((provider) => provider.providerIds));

    const response = ProvidersResponseSchema.parse({
      success: true,
      providers: Array.from(KNOWN_PROVIDERS.entries()).map(([id, provider]) => ({
        id,
        name: provider.name,
        detected: detectedIds.has(id),
        defaultModel: provider.defaultModel,
        models: provider.models,
      })),
      active: {
        id: providerResolution.provider.id,
        source: providerResolution.source,
      },
    });

    return c.json(response);
  });

  return app;
}

async function getProviderResolution(
  detectedProviders: DetectedProvider[],
  rootDir: string
): Promise<ProviderResolution> {
  const configResult = await loadStudioConfig(rootDir);
  return resolveProvider(configResult?.config ?? {}, detectedProviders);
}
