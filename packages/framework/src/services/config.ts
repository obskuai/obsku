import { Config, Context, Effect, Layer } from "effect";
import { DEFAULTS } from "../defaults";

export interface ObskuConfig {
  readonly maxIterations: number;
  readonly toolConcurrency: number;
  readonly toolTimeout: number;
}

export class ConfigService extends Context.Tag("@obsku/ConfigService")<
  ConfigService,
  ObskuConfig
>() {}

export const ConfigLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const toolConcurrency = yield* Config.number("OBSKU_TOOL_CONCURRENCY").pipe(
      Config.withDefault(3)
    );
    const toolTimeout = yield* Config.number("OBSKU_TOOL_TIMEOUT").pipe(
      Config.withDefault(DEFAULTS.toolTimeout)
    );
    const maxIterations = yield* Config.number("OBSKU_MAX_ITERATIONS").pipe(Config.withDefault(10));

    return {
      maxIterations,
      toolConcurrency,
      toolTimeout,
    };
  })
);

export const makeConfigLayer = (config: ObskuConfig): Layer.Layer<ConfigService> =>
  Layer.succeed(ConfigService, config);
