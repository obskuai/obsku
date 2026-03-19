/**
 * Characterization tests for SSE teardown / error-close paths in shared.ts.
 *
 * Purpose (Task 5 / Wave 1): Pin current behaviour of createSSEStream,
 * formatSSEMessage, and createWriteErr error/close paths so Wave-2/3
 * refactors cannot accidentally break them.
 *
 * Rules:
 *  - Tests are READ-ONLY observers; production source files are NOT modified.
 *  - Each test documents WHY the current behaviour is the expected baseline.
 */

import { describe, expect, it, spyOn } from "bun:test";
import { createSSEStream, createWriteErr, formatSSEMessage } from "../src/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a Response stream fully to a string. */
async function drainText(response: Response): Promise<string> {
  return response.text();
}

// ---------------------------------------------------------------------------
// formatSSEMessage — pure serialization
// ---------------------------------------------------------------------------

describe("formatSSEMessage characterization", () => {
  it("serializes data-only message with double newline terminator", () => {
    const out = formatSSEMessage({ data: "hello" });
    expect(out).toBe("data: hello\n\n");
  });

  it("includes event: line when event field is present", () => {
    const out = formatSSEMessage({ data: "payload", event: "myEvent" });
    expect(out).toBe("event: myEvent\ndata: payload\n\n");
  });

  it("JSON.stringifies non-string data", () => {
    const out = formatSSEMessage({ data: { ok: true } });
    expect(out).toBe('data: {"ok":true}\n\n');
  });

  it("splits multiline data into one data: prefix per line", () => {
    const out = formatSSEMessage({ data: "line1\nline2" });
    expect(out).toBe("data: line1\ndata: line2\n\n");
  });
});

// ---------------------------------------------------------------------------
// createWriteErr — error-writer factory
// ---------------------------------------------------------------------------

describe("createWriteErr characterization", () => {
  it("writes to process.stderr when no logger is provided", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const writeErr = createWriteErr();
      writeErr("test error message");
      // Pin: exactly one write to stderr with the message + newline
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe("test error message\n");
    } finally {
      spy.mockRestore();
    }
  });

  it("calls logger.error when logger is provided", () => {
    const logged: Array<string> = [];
    const writeErr = createWriteErr({ error: (msg) => logged.push(msg) });
    writeErr("custom error");
    // Pin: logger.error receives the raw message (no appended newline)
    expect(logged).toEqual(["custom error"]);
  });

  it("does NOT write to stderr when logger is provided", () => {
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const writeErr = createWriteErr({ error: () => {} });
      writeErr("msg");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// createSSEStream — stream lifecycle
// ---------------------------------------------------------------------------

describe("createSSEStream normal flow characterization", () => {
  it("enqueues sent data and closes stream when handler completes normally", async () => {
    const response = createSSEStream(
      new AbortController().signal,
      async (send, _isAborted, close) => {
        send("chunk-a");
        send("chunk-b");
        close();
      },
      () => {}
    );

    const text = await drainText(response);
    // Pin: data appears in order, stream terminates
    expect(text).toContain("chunk-a");
    expect(text).toContain("chunk-b");
  });

  it("sets correct Content-Type and cache headers", () => {
    const response = createSSEStream(
      new AbortController().signal,
      async (_send, _isAborted, close) => {
        close();
      },
      () => {}
    );

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });
});

// ---------------------------------------------------------------------------
// createSSEStream — close deduplication (negative path)
// ---------------------------------------------------------------------------

describe("createSSEStream close deduplication characterization", () => {
  it("calling close() a second time is silently ignored — stream ends cleanly", async () => {
    const errors: Array<string> = [];

    const response = createSSEStream(
      new AbortController().signal,
      async (send, _isAborted, close) => {
        send("data");
        close(); // first close — closes the stream
        close(); // second close — should be a no-op, NOT throw
      },
      (msg) => errors.push(msg)
    );

    const text = await drainText(response);
    // Pin: no error messages; stream completes with the sent data
    expect(errors).toHaveLength(0);
    expect(text).toContain("data");
  });
});

// ---------------------------------------------------------------------------
// createSSEStream — send after close (negative path)
// ---------------------------------------------------------------------------

describe("createSSEStream send-after-close characterization", () => {
  it("send() called after close() is silently ignored — no duplicate data", async () => {
    const errors: Array<string> = [];

    const response = createSSEStream(
      new AbortController().signal,
      async (send, _isAborted, close) => {
        send("legitimate");
        close();
        send("spurious"); // should be a no-op after close
      },
      (msg) => errors.push(msg)
    );

    const text = await drainText(response);
    // Pin: only the pre-close data is in the stream
    expect(text).toContain("legitimate");
    expect(text).not.toContain("spurious");
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createSSEStream — abort signal (negative path)
// ---------------------------------------------------------------------------

describe("createSSEStream abort signal characterization", () => {
  it("isAborted() returns false before abort fires and true after", async () => {
    const ac = new AbortController();
    const snapshots: Array<boolean> = [];

    // The ReadableStream start() is called synchronously during construction
    // so the handler runs during createSSEStream() itself.
    createSSEStream(
      ac.signal,
      async (send, isAborted) => {
        snapshots.push(isAborted()); // should be false
        ac.abort(); // fires synchronously → aborted = true
        snapshots.push(isAborted()); // should be true
        send("before"); // no-op (aborted)
        // Note: close() is also no-op after abort; stream stays open.
        // We don't consume the response here — we only test the predicate.
      },
      () => {}
    );

    // Handler body ran synchronously up to the first microtask boundary.
    // Yield once so the async handler has finished.
    await Promise.resolve();

    // Pin: the predicate correctly reflects abort state transitions
    expect(snapshots[0]).toBe(false);
    expect(snapshots[1]).toBe(true);
  });

  it("send() after abort fires does NOT enqueue data", async () => {
    const ac = new AbortController();
    const errors: Array<string> = [];

    // We use abort THEN close to let the stream terminate.
    // close() is a no-op when aborted, so we rely on the finally block.
    // BUT: finally only calls controller.close() when !aborted && !closed.
    // So with abort=true, the finally block does NOT close the controller.
    // To get a clean test, we abort AFTER calling close().
    const response = createSSEStream(
      ac.signal,
      async (send, _isAborted, close) => {
        send("before-close");
        close(); // closes the stream properly
        ac.abort(); // abort after close — aborted flag set, but stream already closed
        send("after-abort"); // no-op: closed=true takes effect first
      },
      (msg) => errors.push(msg)
    );

    const text = await drainText(response);
    // Pin: only pre-close data in stream, abort after close is harmless
    expect(text).toContain("before-close");
    expect(text).not.toContain("after-abort");
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createSSEStream — handler throw (negative path)
// ---------------------------------------------------------------------------

describe("createSSEStream handler throw characterization", () => {
  it("when handler throws, finally block runs and stream is closed", async () => {
    const errors: Array<string> = [];

    const response = createSSEStream(
      new AbortController().signal,
      async (send) => {
        send("pre-throw");
        throw new Error("handler boom");
      },
      (msg) => errors.push(msg)
    );

    // The stream should close (via finally → controller.close()), so
    // response.text() must eventually resolve (not hang).
    // Depending on runtime, it may resolve with data or throw.
    let resolvedText: string | undefined;
    let thrownError: unknown;
    try {
      resolvedText = await drainText(response);
    } catch (e) {
      thrownError = e;
    }

    // Pin: the stream terminates one way or another — no infinite hang.
    // Either: resolved with pre-throw data, or rejected with the error.
    const terminated = resolvedText !== undefined || thrownError !== undefined;
    expect(terminated).toBe(true);

    // Pin: if it resolves, the pre-throw data is present
    if (resolvedText !== undefined) {
      expect(resolvedText).toContain("pre-throw");
    }
  });
});
