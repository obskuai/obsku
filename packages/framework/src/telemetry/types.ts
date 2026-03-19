export interface TelemetryConfig {
  enabled: boolean;
  serviceName?: string;
}

/** OpenTelemetry gen_ai semantic convention attributes */
export interface GenAiAttributes {
  [key: string]: string | number | boolean | undefined;
  "gen_ai.request.model"?: string;
  "gen_ai.system"?: string;
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;
}
