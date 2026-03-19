import { describe, expect, test } from "bun:test";
import { resolveTruncation } from "../../src/agent/truncation-resolve";
import { InMemoryBlobStore } from "../../src/blob/in-memory";
import type { TruncationConfig } from "../../src/types/config";

describe("resolveTruncation", () => {
  test("undefined config returns { active: false }", () => {
    const result = resolveTruncation(undefined, 100_000);
    expect(result).toEqual({ active: false });
  });

  test("{ enabled: false } returns { active: false }", () => {
    const result = resolveTruncation({ enabled: false }, 100_000);
    expect(result).toEqual({ active: false });
  });

  test("empty config {} returns { active: false }", () => {
    const result = resolveTruncation({}, 100_000);
    expect(result).toEqual({ active: false });
  });

  test("{ enabled: true } with contextWindowSize returns active with computed threshold", () => {
    const result = resolveTruncation({ enabled: true }, 100_000);
    expect(result.active).toBe(true);
    if (result.active) {
      // Math.floor((100_000 * 0.05) / 4) = Math.floor(5000 / 4) = 1250
      expect(result.config.threshold).toBe(1250);
      expect(result.config.blobStore).toBeUndefined();
    }
  });

  test("{ threshold: 5000 } auto-enables and uses explicit threshold", () => {
    const result = resolveTruncation({ threshold: 5000 }, undefined);
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.config.threshold).toBe(5000);
      expect(result.config.blobStore).toBeUndefined();
    }
  });

  test("{ blobStore: store } auto-enables with computed threshold", () => {
    const blobStore = new InMemoryBlobStore();
    const result = resolveTruncation({ blobStore }, 200_000);
    expect(result.active).toBe(true);
    if (result.active) {
      // Math.floor((200_000 * 0.05) / 4) = Math.floor(10000 / 4) = 2500
      expect(result.config.threshold).toBe(2500);
      expect(result.config.blobStore).toBe(blobStore);
    }
  });

  test("{ enabled: false, threshold: 5000 } - explicit disable wins", () => {
    const result = resolveTruncation({ enabled: false, threshold: 5000 }, 100_000);
    expect(result).toEqual({ active: false });
  });

  test("{ enabled: true } without providerContextWindowSize throws error", () => {
    expect(() => resolveTruncation({ enabled: true }, undefined)).toThrow(
      "Truncation enabled but threshold cannot be resolved"
    );
  });

  test("{ enabled: true } with contextWindowSize 0 throws error", () => {
    expect(() => resolveTruncation({ enabled: true }, 0)).toThrow(
      "Truncation enabled but threshold cannot be resolved"
    );
  });

  test("{ enabled: true } with negative contextWindowSize throws error", () => {
    expect(() => resolveTruncation({ enabled: true }, -100)).toThrow(
      "Truncation enabled but threshold cannot be resolved"
    );
  });

  test("computed threshold formula: Math.floor((contextWindowSize * 0.05) / 4)", () => {
    const testCases: Array<{ expected: number; input: number }> = [
      { expected: 2500, input: 200_000 }, // Math.floor((200000 * 0.05) / 4) = 2500
      { expected: 1250, input: 100_000 }, // Math.floor((100000 * 0.05) / 4) = 1250
      { expected: 1000, input: 80_000 }, // Math.floor((80000 * 0.05) / 4) = 1000
      { expected: 500, input: 40_000 }, // Math.floor((40000 * 0.05) / 4) = 500
      { expected: 50, input: 4000 }, // Math.floor((4000 * 0.05) / 4) = 50
    ];

    for (const { expected, input } of testCases) {
      const result = resolveTruncation({ enabled: true }, input);
      expect(result.active).toBe(true);
      if (result.active) {
        expect(result.config.threshold).toBe(expected);
      }
    }
  });

  test("{ enabled: true, threshold: 3000 } uses explicit threshold over computed", () => {
    const result = resolveTruncation({ enabled: true, threshold: 3000 }, 100_000);
    expect(result.active).toBe(true);
    if (result.active) {
      // Should use explicit threshold, not computed 1250
      expect(result.config.threshold).toBe(3000);
    }
  });

  test("{ enabled: true, blobStore, threshold: 4000 } includes all config", () => {
    const blobStore = new InMemoryBlobStore();
    const result = resolveTruncation({ blobStore, enabled: true, threshold: 4000 }, 100_000);
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.config.threshold).toBe(4000);
      expect(result.config.blobStore).toBe(blobStore);
    }
  });

  test("{ enabled: undefined, threshold: 5000 } auto-enables when threshold set", () => {
    const result = resolveTruncation({ threshold: 5000 }, undefined);
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.config.threshold).toBe(5000);
    }
  });

  test("{ enabled: undefined, blobStore } auto-enables when blobStore set", () => {
    const blobStore = new InMemoryBlobStore();
    const result = resolveTruncation({ blobStore }, 100_000);
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.config.blobStore).toBe(blobStore);
    }
  });

  test("type discrimination works correctly", () => {
    const inactive = resolveTruncation({ enabled: false }, 100_000);
    expect(inactive.active).toBe(false);
    // Type narrowing: when active is false, config should not exist
    if (inactive.active === false) {
      expect("config" in inactive).toBe(false);
    }

    const active = resolveTruncation({ enabled: true }, 100_000);
    expect(active.active).toBe(true);
    // Type narrowing: when active is true, config should exist
    if (active.active === true) {
      expect(active.config).toBeDefined();
      expect(active.config.threshold).toBe(1250);
    }
  });
});

describe("resolveTruncation edge cases", () => {
  test("handles null blobStore correctly", () => {
    const config: TruncationConfig = {
      enabled: true,
      threshold: 2000,
    };
    const result = resolveTruncation(config, 100_000);
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.config.blobStore).toBeUndefined();
    }
  });

  test("undefined threshold and undefined contextWindowSize throws", () => {
    expect(() => resolveTruncation({ enabled: true }, undefined)).toThrow(
      "Truncation enabled but threshold cannot be resolved"
    );
  });
});
