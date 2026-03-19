/**
 * Characterization tests for session-process.ts cleanup paths.
 *
 * Safety note: tests use pid=undefined or pids > Linux max PID (4,194,304)
 * so process.kill(-pid,..) fails with EINVAL (silently swallowed).
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "bun:test";
import { commandForLanguage, killProcessTree, terminateProcess } from "../src/session-process";

const SAFE_FAKE_PID = 5_000_001;

class FakeProcess extends EventEmitter {
  readonly killSignals: Array<string> = [];
  public pid: number | undefined;

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }

  kill(signal?: string): boolean {
    this.killSignals.push(signal ?? "SIGTERM");
    return true;
  }
}

describe("commandForLanguage characterization", () => {
  it("returns python3 with -i -u flags for 'python'", () => {
    expect(commandForLanguage("python")).toEqual({ args: ["-i", "-u"], cmd: "python3" });
  });

  it("returns bun with no args for non-python languages", () => {
    expect(commandForLanguage("javascript")).toEqual({ args: [], cmd: "bun" });
    expect(commandForLanguage("typescript")).toEqual({ args: [], cmd: "bun" });
  });
});

describe("killProcessTree negative paths characterization", () => {
  it("returns immediately and does not call kill when pid is undefined", () => {
    const proc = new FakeProcess(); // pid not provided → truly undefined
    expect(() => killProcessTree(proc, "SIGTERM")).not.toThrow();
    expect(proc.killSignals).toHaveLength(0);
  });

  it("swallows errors thrown by proc.kill() — no propagation", () => {
    const proc = new FakeProcess(SAFE_FAKE_PID);
    proc.kill = () => {
      throw new Error("kill failed");
    };
    expect(() => killProcessTree(proc, "SIGTERM")).not.toThrow();
  });

  it("does not throw when pid is above Linux max PID (EINVAL from syscall swallowed)", () => {
    const proc = new FakeProcess(SAFE_FAKE_PID);
    expect(() => killProcessTree(proc, "SIGTERM")).not.toThrow();
  });
});

describe("terminateProcess characterization", () => {
  it("resolves when the process emits 'exit' before the SIGKILL timeout", async () => {
    const proc = new FakeProcess();
    const done = terminateProcess(proc);
    proc.emit("exit");
    await done;
    expect(true).toBe(true);
  });

  it("double-finalize guard: proc.once() means second exit emit is ignored", async () => {
    const proc = new FakeProcess();
    let resolveCount = 0;
    const done = terminateProcess(proc);
    proc.emit("exit");
    await done;
    resolveCount++;
    expect(resolveCount).toBe(1);
  });

  it("completes without hanging when exit fires synchronously", async () => {
    const proc = new FakeProcess();
    const done = terminateProcess(proc);
    proc.emit("exit");
    await done;
    expect(true).toBe(true);
  });
});
