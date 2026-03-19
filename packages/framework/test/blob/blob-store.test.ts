import { describe, expect, it } from "bun:test";
import { InMemoryBlobStore } from "../../src/blob/in-memory";

describe("BlobStore", () => {
  describe("put/get/delete operations", () => {
    it("should store and retrieve Buffer data", async () => {
      const store = new InMemoryBlobStore();
      const data = Buffer.from("hello world");
      const key = "test-key";

      const returnedKey = await store.put(key, data);
      expect(returnedKey).toBe(key);

      const retrieved = await store.get(key);
      expect(retrieved).toEqual(data);
    });

    it("should store and retrieve string data", async () => {
      const store = new InMemoryBlobStore();
      const data = "hello world";
      const key = "test-key";

      const returnedKey = await store.put(key, data);
      expect(returnedKey).toBe(key);

      const retrieved = await store.get(key);
      expect(retrieved).toEqual(Buffer.from(data));
    });

    it("should return null for missing key", async () => {
      const store = new InMemoryBlobStore();
      const retrieved = await store.get("non-existent-key");
      expect(retrieved).toBeNull();
    });

    it("should delete stored data", async () => {
      const store = new InMemoryBlobStore();
      const data = Buffer.from("test data");
      const key = "test-key";

      await store.put(key, data);
      await store.delete(key);

      const retrieved = await store.get(key);
      expect(retrieved).toBeNull();
    });

    it("should handle concurrent puts to same key", async () => {
      const store = new InMemoryBlobStore();
      const key = "concurrent-key";

      const results = await Promise.all([
        store.put(key, Buffer.from("data1")),
        store.put(key, Buffer.from("data2")),
        store.put(key, Buffer.from("data3")),
      ]);

      // All should return the same key
      expect(results.every((r) => r === key)).toBe(true);

      // Last write should win
      const retrieved = await store.get(key);
      expect(retrieved).not.toBeNull();
    });

    it("should handle concurrent puts to different keys", async () => {
      const store = new InMemoryBlobStore();

      await Promise.all([
        store.put("key1", Buffer.from("data1")),
        store.put("key2", Buffer.from("data2")),
        store.put("key3", Buffer.from("data3")),
      ]);

      const retrieved1 = await store.get("key1");
      const retrieved2 = await store.get("key2");
      const retrieved3 = await store.get("key3");

      expect(retrieved1).toEqual(Buffer.from("data1"));
      expect(retrieved2).toEqual(Buffer.from("data2"));
      expect(retrieved3).toEqual(Buffer.from("data3"));
    });
  });
});
