import { describe, expect, it } from "bun:test";
import { parseJsonBody } from "../src/base-handler";

describe("parseJsonBody size limit", () => {
  it("rejects body larger than 1MB", async () => {
    const largeBody = "x".repeat(1_048_577); // 1MB + 1 byte
    const req = new Request("http://localhost", {
      method: "POST",
      body: largeBody,
      headers: { "content-type": "application/json" },
    });

    await expect(parseJsonBody(req)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });

  it("accepts body at exactly 1MB", async () => {
    const body = JSON.stringify({ data: "x".repeat(100) });
    const req = new Request("http://localhost", {
      method: "POST",
      body: body,
      headers: { "content-type": "application/json" },
    });

    const result = await parseJsonBody(req);
    expect(result).toEqual({ data: expect.any(String) });
  });

  it("allows custom maxBodySize", async () => {
    const body = "x".repeat(100);
    const req = new Request("http://localhost", {
      method: "POST",
      body: body,
      headers: { "content-type": "application/json" },
    });

    await expect(parseJsonBody(req, undefined, "[Test]", 50)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });

  it("rejects body larger than custom maxBodySize", async () => {
    const body = JSON.stringify({ test: "data" });
    const req = new Request("http://localhost", {
      method: "POST",
      body: body,
      headers: { "content-type": "application/json" },
    });

    // Default 1MB limit should allow this small body
    const result = await parseJsonBody(req);
    expect(result).toEqual({ test: "data" });
  });

  it("rejects based on content-length header", async () => {
    const largeBody = "x".repeat(100);
    const req = new Request("http://localhost", {
      method: "POST",
      body: largeBody,
      headers: {
        "content-type": "application/json",
        "content-length": "2000000", // Claim it's 2MB
      },
    });

    await expect(parseJsonBody(req)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });

  it("logs error when writeErr is provided", async () => {
    const errors: string[] = [];
    const writeErr = (msg: string) => errors.push(msg);

    const largeBody = "x".repeat(1_048_577);
    const req = new Request("http://localhost", {
      method: "POST",
      body: largeBody,
      headers: { "content-type": "application/json" },
    });

    await expect(parseJsonBody(req, writeErr)).rejects.toThrow("PAYLOAD_TOO_LARGE");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Request body too large");
  });
});

import { parseJsonRequest } from "../src/handler-utils";
import { HTTP_STATUS } from "../src/constants";

describe("parseJsonRequest size limit", () => {
  it("returns 413 status for payload too large", async () => {
    const largeBody = "x".repeat(1_048_577); // 1MB + 1 byte
    const req = new Request("http://localhost", {
      method: "POST",
      body: largeBody,
      headers: { "content-type": "application/json" },
    });

    const result = await parseJsonRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE);
    }
  });

  it("returns 400 status for invalid JSON", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: "not valid json",
      headers: { "content-type": "application/json" },
    });

    const result = await parseJsonRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });
});
