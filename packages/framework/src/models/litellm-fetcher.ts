import { z } from "zod";
import { DEFAULTS } from "../defaults";
import { getErrorMessage } from "../utils";

export interface LiteLLMModelEntry {
  litellm_provider?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  mode?: string;
}

export type LiteLLMModelsMap = Record<string, LiteLLMModelEntry>;

export type LiteLLMFetchResult =
  | { data: LiteLLMModelsMap; ok: true }
  | { error: string; ok: false; reason: "http" | "parse" | "network" };

const LiteLLMModelSchema = z
  .object({
    litellm_provider: z.string().optional(),
    max_input_tokens: z.number().optional(),
    max_output_tokens: z.number().optional(),
    mode: z.string().optional(),
  })
  .strip();

const LiteLLMModelsSchema = z.record(z.string(), LiteLLMModelSchema);

export async function fetchLiteLLMModels(
  url: string = DEFAULTS.modelRegistry.litellmUrl,
  timeoutMs: number = DEFAULTS.modelRegistry.fetchTimeout
): Promise<LiteLLMFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { error: `HTTP ${response.status}`, ok: false, reason: "http" };
    }
    const payload = await response.json();
    const parsed = LiteLLMModelsSchema.safeParse(payload);
    if (!parsed.success) {
      return { error: parsed.error.message, ok: false, reason: "parse" };
    }
    return { data: parsed.data, ok: true };
  } catch (error: unknown) {
    return { error: getErrorMessage(error), ok: false, reason: "network" };
  } finally {
    clearTimeout(timeoutId);
  }
}
