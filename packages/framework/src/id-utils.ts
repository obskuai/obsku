import { DEFAULTS } from "./defaults";

export function generateId(prefix?: string): string {
  if (prefix) {
    return `${prefix}-${crypto.randomUUID().slice(0, DEFAULTS.preview.shortIdLength)}`;
  }
  return `${Date.now()}-${crypto.randomUUID().slice(0, DEFAULTS.preview.shortIdLength)}`;
}
