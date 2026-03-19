import type { BlobStore } from "./types";

export class InMemoryBlobStore implements BlobStore {
  private storage = new Map<string, Buffer>();

  async put(key: string, data: Buffer | string): Promise<string> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.storage.set(key, buffer);
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    return this.storage.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }
}
