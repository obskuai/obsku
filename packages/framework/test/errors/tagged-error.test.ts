import { describe, expect, it } from "bun:test";
import { createTaggedError } from "../../src/errors/tagged-error";

describe("createTaggedError", () => {
  it("produces instances that extend Error", () => {
    const MyError = createTaggedError("MyError");
    expect(new MyError("oops")).toBeInstanceOf(Error);
  });

  it("produces instances with correct _tag", () => {
    const MyError = createTaggedError("MyError");
    expect(new MyError("oops")._tag).toBe("MyError");
  });

  it("produces instances with correct name", () => {
    const MyError = createTaggedError("MyError");
    expect(new MyError("oops").name).toBe("MyError");
  });

  it("produces instances with correct message", () => {
    const MyError = createTaggedError("MyError");
    expect(new MyError("something went wrong").message).toBe("something went wrong");
  });

  it("instanceof check works for factory-produced class", () => {
    const MyError = createTaggedError("MyError");
    const err = new MyError("msg");
    expect(err).toBeInstanceOf(MyError);
  });

  it("different tags produce independent classes", () => {
    const FooError = createTaggedError("FooError");
    const BarError = createTaggedError("BarError");
    const foo = new FooError("f");
    const bar = new BarError("b");
    expect(foo._tag).toBe("FooError");
    expect(bar._tag).toBe("BarError");
    expect(foo).not.toBeInstanceOf(BarError);
    expect(bar).not.toBeInstanceOf(FooError);
  });

  it("subclass preserves _tag and name from factory", () => {
    class CustomError extends createTaggedError("CustomError") {
      constructor(readonly code: number) {
        super(`Error code ${code}`);
      }
    }
    const err = new CustomError(42);
    expect(err._tag).toBe("CustomError");
    expect(err.name).toBe("CustomError");
    expect(err.message).toBe("Error code 42");
    expect(err.code).toBe(42);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CustomError);
  });

  it("subclass instanceof Error chain works", () => {
    class SubError extends createTaggedError("SubError") {
      constructor(readonly id: string) {
        super(`Not found: ${id}`);
      }
    }
    const err = new SubError("abc");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SubError);
    expect(err._tag).toBe("SubError");
    expect(err.name).toBe("SubError");
    expect(err.message).toBe("Not found: abc");
  });
});
