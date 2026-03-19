export function createTaggedError<T extends string>(tag: T) {
  return class extends Error {
    readonly _tag = tag as T;
    constructor(message: string) {
      super(message);
      this.name = tag;
    }
  };
}
