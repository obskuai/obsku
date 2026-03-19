import { z } from "zod";
import type { PluginCtx, PluginDef, PluginRunOutput } from "../types";
import { isAsyncIterable, toToolResultEnvelope } from "../utils";
import type { TaskManager } from "./task-manager";

async function resolveRunOutput(
  runFn: () => Promise<PluginRunOutput> | AsyncIterable<PluginRunOutput>
): Promise<PluginRunOutput> {
  const result = runFn();
  if (isAsyncIterable(result)) {
    let lastValue: PluginRunOutput;
    for await (const chunk of result) {
      lastValue = chunk;
    }
    return lastValue;
  }
  return result;
}

const backgroundPluginMarker = Symbol("background");

const BackgroundSchema = z
  .object({
    wait: z
      .boolean()
      .optional()
      .describe(
        "If true, wait for result synchronously. If false (default), run in background and return taskId immediately."
      ),
  })
  .catchall(z.unknown());

export function buildBackgroundPlugin(
  pluginDef: PluginDef,
  taskManager: TaskManager
): PluginDef<typeof BackgroundSchema> {
  const wrapped: PluginDef<typeof BackgroundSchema> = {
    description: pluginDef.description,
    name: pluginDef.name,
    params: BackgroundSchema,
    run: async (input, ctx) => {
      const { wait, ...rest } = input;

      if (wait === true) {
        return await resolveRunOutput(() => pluginDef.run(rest as Record<string, unknown>, ctx));
      }

      const taskId = taskManager.start(pluginDef.name, () =>
        resolveRunOutput(() => pluginDef.run(rest as Record<string, unknown>, ctx))
      );
      return { taskId };
    },
  };

  Object.defineProperty(wrapped, backgroundPluginMarker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return wrapped;
}

function getSymbolProperty(def: unknown, sym: symbol): unknown {
  if (typeof def === "object" && def !== null && sym in def) {
    return (def as Record<symbol, unknown>)[sym];
  }
  return undefined;
}

export function isBackground(pluginDef: PluginDef): boolean {
  return getSymbolProperty(pluginDef, backgroundPluginMarker) === true;
}

const GetResultSchema = z
  .object({
    taskId: z.string().describe("The taskId returned when the background task was started"),
  })
  .refine((value) => typeof value.taskId === "string", {
    message: "taskId is required",
  });

export function buildGetResultPlugin(taskManager: TaskManager): PluginDef<typeof GetResultSchema> {
  return {
    description:
      "Retrieve the result of a background task by its taskId. Returns the result if completed, current status if still running, or error if failed.",
    name: "get_result",
    params: GetResultSchema,
    run: async ({ taskId }, _ctx: PluginCtx) => {
      if (!taskId) {
        return toToolResultEnvelope({
          data: null,
          error: "taskId is required",
          status: "not_found",
          success: false,
        });
      }

      const entry = taskManager.getResult(taskId);

      if (!entry) {
        return toToolResultEnvelope({
          data: null,
          error: `Task not found: ${taskId}`,
          status: "not_found",
          success: false,
        });
      }

      switch (entry.state) {
        case "completed": {
          return toToolResultEnvelope(entry.result);
        }
        case "running":
          return toToolResultEnvelope({
            data: null,
            error: null,
            startedAt: entry.startedAt,
            status: "running",
            success: false,
          });
        case "failed":
          return toToolResultEnvelope({
            data: null,
            error: entry.error,
            status: "failed",
            success: false,
          });
        case "timeout":
          return toToolResultEnvelope({
            data: null,
            error: null,
            status: "timeout",
            success: false,
          });
        default:
          return toToolResultEnvelope({
            data: null,
            error: null,
            status: entry.state,
            success: false,
          });
      }
    },
  };
}
