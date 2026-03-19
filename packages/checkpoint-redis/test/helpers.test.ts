import { describe, expect, it } from "bun:test";
import { JsonPlusSerializer } from "@obsku/framework/internal";
import type { RedisClientType } from "redis";
import { z } from "zod";
import { mGetDeserialize } from "../src/ops/helpers";

describe("mGetDeserialize", () => {
  it("filters null mget results and keeps only deserialized items", async () => {
    const serializer = new JsonPlusSerializer();
    const schema = z.object({ id: z.number() });
    const calls: Array<Array<string>> = [];
    const keys = ["k1", "k2", "k3"];

    const client = {
      async mGet(chunk: Array<string>) {
        calls.push(chunk);
        return [serializer.serialize({ id: 1 }), null, serializer.serialize({ id: 2 })];
      },
    } as unknown as RedisClientType;

    const result = await mGetDeserialize(
      client,
      serializer,
      schema,
      keys,
      "test deserialize failed"
    );

    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toEqual([keys]);
  });
});
