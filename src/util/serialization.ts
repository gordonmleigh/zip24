import { BufferView, type BufferLike } from "./binary.js";

export type Deserializer<T> = {
  deserialize: (
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ) => T;
};

export type Serializable = {
  serialize: (
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ) => Uint8Array;
};

export function makeBuffer(
  requiredLength: number,
  buffer: BufferLike | undefined,
  byteOffset?: number,
  byteLength?: number,
): BufferView {
  if (buffer) {
    if (byteLength !== undefined && byteLength < requiredLength) {
      throw new RangeError(
        `the buffer must be at least ${requiredLength} bytes (got ${byteLength})`,
      );
    }
    return new BufferView(buffer, byteOffset, requiredLength);
  }
  return BufferView.alloc(requiredLength);
}
