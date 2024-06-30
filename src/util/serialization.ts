import type { BufferLike } from "./binary.js";

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
