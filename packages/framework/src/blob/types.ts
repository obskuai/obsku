export interface BlobStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer | string): Promise<string>;
}
