import type { z } from "zod";
import { agent } from "../agent";
import type { AgentDef, LLMProvider, ResponseFormat } from "../types";
import { parseStructuredOutput, StructuredOutputError, validateOutput } from "./output";
import { zodToJsonSchema } from "./schema";

export { StructuredOutputError, parseStructuredOutput, validateOutput, zodToJsonSchema };

/**
 * Configuration for structured output agent.
 */
export interface StructuredAgentDef<T> extends Omit<AgentDef, "name"> {
  maxRetries?: number;
  name: string;
  output: z.ZodType<T>;
}

/**
 * Create an agent that validates LLM output against a Zod schema.
 * Automatically retries on validation failure (up to maxRetries).
 *
 * @param def - Agent definition with Zod schema
 * @returns Agent that returns typed output
 */
export function structuredAgent<T>(def: StructuredAgentDef<T>) {
  const maxRetries = def.maxRetries ?? 3;
  const jsonSchema = zodToJsonSchema(def.output);

  // Build ResponseFormat for native structured output support
  const responseFormat: ResponseFormat = {
    jsonSchema: {
      name: def.name,
      schema: jsonSchema,
    },
    type: "json_schema",
  };

  // Create base agent with enhanced prompt
  const baseAgent = agent({
    ...def,
    prompt: (ctx) => {
      // Resolve the original prompt if it's a function
      const basePrompt = typeof def.prompt === "function" ? def.prompt(ctx) : def.prompt;

      return `${basePrompt}

**CRITICAL: You MUST respond with valid JSON matching this exact schema:**
\`\`\`json
${JSON.stringify(jsonSchema, null, 2)}
\`\`\`

Do not include any text before or after the JSON. Only output the JSON object.`;
    },
  });

  return {
    name: def.name,
    async run(input: string, provider: LLMProvider): Promise<T> {
      let lastError: StructuredOutputError | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let augmentedInput = input;
        if (attempt > 0 && lastError) {
          augmentedInput = `${input}

**Previous attempt failed validation. Errors:**
${lastError.validationErrors.join("\n")}

**Please try again with valid JSON matching the schema.**`;
        }

        try {
          const result = await baseAgent.run(augmentedInput, provider, { responseFormat });
          const parsed = parseStructuredOutput(def.output, result);
          if (parsed.ok) {
            return parsed.value;
          }

          lastError = new StructuredOutputError([parsed.error], result);
          if (attempt === maxRetries) {
            throw lastError;
          }
        } catch (error: unknown) {
          if (!(error instanceof StructuredOutputError)) {
            throw error;
          }

          lastError = error;
          if (attempt === maxRetries) {
            throw error;
          }
        }
      }

      // Should never reach here, but TypeScript needs it
      throw lastError ?? new Error("Unreachable: retry loop exited without error");
    },
  };
}
