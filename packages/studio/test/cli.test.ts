import { describe, it, expect } from "bun:test";
import { parseCliOptions } from "../src/cli.js";

describe("parseCliOptions", () => {
  it("should parse default values", () => {
    const options = parseCliOptions([]);
    expect(options.port).toBe(3001);
    expect(options.config).toBeUndefined();
    expect(options.scan).toBeUndefined();
    expect(options.help).toBe(false);
    expect(options.version).toBe(false);
  });

  it("should parse custom port", () => {
    const options = parseCliOptions(["--port", "8080"]);
    expect(options.port).toBe(8080);
  });

  it("should parse port shorthand", () => {
    const options = parseCliOptions(["-p", "9000"]);
    expect(options.port).toBe(9000);
  });

  it("should parse config path", () => {
    const options = parseCliOptions(["--config", "./studio.config.js"]);
    expect(options.config).toBe("./studio.config.js");
  });

  it("should parse config shorthand", () => {
    const options = parseCliOptions(["-c", "/path/to/config.json"]);
    expect(options.config).toBe("/path/to/config.json");
  });

  it("should parse scan flag", () => {
    const options = parseCliOptions(["--scan"]);
    expect(options.scan).toBe(true);
  });

  it("should parse scan shorthand", () => {
    const options = parseCliOptions(["-s"]);
    expect(options.scan).toBe(true);
  });

  it("should parse help flag", () => {
    const options = parseCliOptions(["--help"]);
    expect(options.help).toBe(true);
  });

  it("should parse help shorthand", () => {
    const options = parseCliOptions(["-h"]);
    expect(options.help).toBe(true);
  });

  it("should parse version flag", () => {
    const options = parseCliOptions(["--version"]);
    expect(options.version).toBe(true);
  });

  it("should parse version shorthand", () => {
    const options = parseCliOptions(["-v"]);
    expect(options.version).toBe(true);
  });

  it("should parse combined options", () => {
    const options = parseCliOptions(["-p", "4000", "-c", "./config.js", "-s"]);
    expect(options.port).toBe(4000);
    expect(options.config).toBe("./config.js");
    expect(options.scan).toBe(true);
  });

  it("should throw on invalid port", () => {
    expect(() => parseCliOptions(["--port", "not-a-number"])).toThrow();
  });

  it("should throw on port out of range", () => {
    expect(() => parseCliOptions(["--port", "0"])).toThrow();
    expect(() => parseCliOptions(["--port", "70000"])).toThrow();
  });
});
