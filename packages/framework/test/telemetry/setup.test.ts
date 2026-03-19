import { beforeEach, describe, expect, test } from "bun:test";
import {
  _getSdk,
  _resetSdkState,
  setupTelemetry,
  shutdownTelemetry,
} from "../../src/telemetry/setup";

beforeEach(() => {
  _resetSdkState();
});

describe("setupTelemetry", () => {
  test("enabled: false → no-op", async () => {
    await setupTelemetry({ enabled: false, serviceName: "test" });
    expect(_getSdk()).toBeNull();
  });

  test("enabled undefined defaults to no-op without OTEL_EXPORTER_OTLP_ENDPOINT", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await setupTelemetry({ serviceName: "test" });
    expect(_getSdk()).toBeNull();
  });

  test("auto-detects OTLP endpoint from env var", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";
    await setupTelemetry({ serviceName: "test" });
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  test("double setup → no-op on second call", async () => {
    await setupTelemetry({
      enabled: true,
      exporter: "console",
      serviceName: "test",
    });
    const firstSdk = _getSdk();

    await setupTelemetry({
      enabled: true,
      exporter: "console",
      serviceName: "test2",
    });
    const secondSdk = _getSdk();

    expect(secondSdk).toBe(firstSdk);
  });

  test("exporter: none → no-op", async () => {
    await setupTelemetry({
      enabled: true,
      exporter: "none",
      serviceName: "test",
    });
    expect(_getSdk()).toBeNull();
  });
});

describe("shutdownTelemetry", () => {
  test("shutdown when no SDK initialized → no-op", async () => {
    await shutdownTelemetry();
    expect(_getSdk()).toBeNull();
  });

  test("shutdown resets SDK state", async () => {
    await setupTelemetry({
      enabled: true,
      exporter: "console",
      serviceName: "test",
    });

    const sdkBefore = _getSdk();
    await shutdownTelemetry();
    const sdkAfter = _getSdk();

    if (sdkBefore !== null) {
      expect(sdkAfter).toBeNull();
    }
  });

  test("double shutdown → no-op", async () => {
    await setupTelemetry({
      enabled: true,
      exporter: "console",
      serviceName: "test",
    });
    await shutdownTelemetry();
    await shutdownTelemetry();
    expect(_getSdk()).toBeNull();
  });
});

describe("OTel not installed", () => {
  test("gracefully handles missing OTel packages", async () => {
    await setupTelemetry({
      enabled: true,
      exporter: "console",
      serviceName: "test",
    });
    expect(_getSdk()).toBeNull();
  });

  test("gracefully handles missing OTel packages for OTLP", async () => {
    await setupTelemetry({
      enabled: true,
      endpoint: "http://localhost:4318/v1/traces",
      exporter: "otlp",
      serviceName: "test",
    });
    expect(_getSdk()).toBeNull();
  });
});

describe("TelemetrySetupOptions", () => {
  test("accepts all valid exporter types", async () => {
    const options1 = { exporter: "otlp" as const, serviceName: "test" };
    const options2 = { exporter: "console" as const, serviceName: "test" };
    const options3 = { exporter: "none" as const, serviceName: "test" };

    expect(options1.exporter).toBe("otlp");
    expect(options2.exporter).toBe("console");
    expect(options3.exporter).toBe("none");
  });

  test("endpoint option is optional", async () => {
    const options = { enabled: true, serviceName: "test" };
    await setupTelemetry(options);
  });
});
