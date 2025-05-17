import { ZipFormatError } from "../exports/errors.ts";
import { assert } from "./assert.ts";
import { computeCrc32 } from "./crc32.ts";

export type AnyIterable<T> = AsyncIterable<T> | Iterable<T>;
export type ByteSource = AnyIterable<Uint8Array>;

export type RandomAccessReadOptions = {
  buffer: Uint8Array;
  offset?: number | undefined;
  length?: number | undefined;
  position: number;
};

export type RandomAccessReadResult = {
  bytesRead: number;
  buffer: Uint8Array;
};

export type RandomAccessReader = {
  close?: (() => void | PromiseLike<void>) | undefined;
  read: (
    options: RandomAccessReadOptions,
  ) => PromiseLike<RandomAccessReadResult>;
};

export type RandomAccessReaderSourceOptions = {
  byteLength?: number | undefined;
  chunkSize?: number | undefined;
  position?: number | undefined;
};

export type ExtendedReadOptions = {
  buffer: Uint8Array;
  offset?: number | undefined;
  maxLength?: number | undefined;
  minLength?: number | undefined;
  position: number;
};

export async function read(
  reader: RandomAccessReader,
  options: ExtendedReadOptions,
): Promise<number> {
  const {
    buffer,
    offset = 0,
    minLength = 0,
    maxLength = buffer.length - offset,
    position,
  } = options;

  assert(
    maxLength <= buffer.length - offset,
    `maxLength is bigger than buffer length`,
  );
  assert(
    minLength <= buffer.length - offset,
    `minLength is bigger than buffer length`,
  );
  assert(
    minLength > 0 && maxLength > 0 && offset > 0,
    "lengths and offsets must be >0",
  );
  assert(minLength <= maxLength, `minLength is greater than maxLength`);

  let count = 0;
  do {
    const result = await reader.read({
      buffer,
      position: position + count,
      length: maxLength - count,
      offset: offset + count,
    });
    count += result.bytesRead;

    if (result.bytesRead === 0) {
      if (count < minLength) {
        throw new ZipFormatError(`unexpected end of file`);
      }
      break;
    }
  } while (count < minLength);

  return count;
}

export type DataSource =
  | Uint8Array
  | string
  | AsyncIterable<string>
  | AsyncIterable<Uint8Array>
  | Iterable<string>
  | Iterable<Uint8Array>;

export function randomAccessReaderFromBuffer(
  source: Uint8Array,
): RandomAccessReader {
  return {
    read({ buffer, position, offset = 0, length = buffer.length - offset }) {
      const bytesRead = Math.min(
        length,
        Math.max(0, source.byteLength - position),
      );

      if (bytesRead !== 0) {
        buffer.set(source.subarray(position, position + bytesRead), offset);
      }
      return Promise.resolve({ bytesRead, buffer });
    },
  };
}

export function normalizeDataSource(
  data: DataSource | undefined,
): ReadableStream<Uint8Array> {
  let iterator:
    | AsyncIterator<Uint8Array | string>
    | Iterator<Uint8Array | string>
    | undefined;

  let encoder: TextEncoder | undefined;

  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      if (data === undefined) {
        controller.close();
      } else if (typeof data === "string") {
        if (data.length > 0) {
          controller.enqueue(new TextEncoder().encode(data));
        }
        controller.close();
      } else if (data instanceof Uint8Array) {
        if (data.byteLength > 0) {
          controller.enqueue(data);
        }
        controller.close();
      } else if (Symbol.asyncIterator in data) {
        iterator = data[Symbol.asyncIterator]();
      } else if (Symbol.iterator in data) {
        iterator = data[Symbol.iterator]();
      }
    },

    pull: async (controller) => {
      assert(iterator);

      const next = await iterator.next();
      if (next.value !== undefined) {
        encoder ??= new TextEncoder();
        controller.enqueue(encoder.encode(next.value as string));
      }
      if (next.done) {
        controller.close();
      }
    },
  });
}

/**
 * A {@link TransformStream} which counts bytes on the way past.
 */
export class CountBytesStream extends TransformStream<Uint8Array, Uint8Array> {
  public constructor(callback: (count: number) => void) {
    let count = 0;
    super({
      transform: (chunk, controller) => {
        count += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush: () => {
        callback(count);
      },
    });
  }
}

/**
 * A {@link TransformStream} which counts bytes on the way past.
 */
export class Crc32Stream extends TransformStream<Uint8Array, Uint8Array> {
  public constructor(callback: (result: number) => void) {
    let result = 0;
    super({
      transform: (chunk, controller) => {
        result = computeCrc32(chunk, result);
        controller.enqueue(chunk);
      },
      flush: () => {
        callback(result);
      },
    });
  }
}
