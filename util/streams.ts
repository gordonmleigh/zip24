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
    "maxLength must be <= buffer length",
  );
  assert(
    minLength <= buffer.length - offset,
    `minLength must be <= buffer length`,
  );
  assert(maxLength > 0, "maxLength must be > 0");
  assert(minLength >= 0, "minLength must be >= 0");
  assert(offset >= 0, "offset must be >= 0");
  assert(minLength <= maxLength, `minLength must be <= maxLength`);

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

export type ReaderDataInfo = {
  startPosition: number;
  length: number;
};

export type RandomAccessReaderStreamOptions = {
  bufferSize?: number | undefined;
  reader: RandomAccessReader;
  startPosition: number;
} & (
  | {
      header: (firstChunk: Uint8Array) => ReaderDataInfo;
      headerMinLength: number;
    }
  | {
      length: number;
    }
);

export class RandomAccessReaderStream extends ReadableStream<Uint8Array> {
  public constructor(options: RandomAccessReaderStreamOptions) {
    const { bufferSize = 128 * 1024, reader } = options;

    let position = options.startPosition;
    let endPosition: number | undefined;

    if ("length" in options) {
      endPosition = position + options.length;
    }

    super({
      start: async (controller) => {
        const buffer = new Uint8Array(bufferSize);

        if (!("header" in options)) {
          return;
        }

        const length = await read(reader, {
          buffer,
          position,
          minLength: options.headerMinLength,
        });

        const dataInfo = options.header(buffer);
        const skipBytes = dataInfo.startPosition - position;
        const firstChunkLength = Math.min(length - skipBytes, dataInfo.length);
        position = dataInfo.startPosition;
        endPosition = dataInfo.startPosition + dataInfo.length;

        if (firstChunkLength > 0) {
          const firstChunk = buffer.subarray(
            skipBytes,
            skipBytes + firstChunkLength,
          );
          controller.enqueue(firstChunk);
          position += firstChunkLength;
        }
        if (position === endPosition) {
          controller.close();
        }
      },

      pull: async (controller) => {
        assert(endPosition !== undefined);
        const remaining = endPosition - position;
        if (remaining === 0) {
          controller.close();
          return;
        }

        assert(remaining > 0, `remaining bytes should be >= 0`);
        const buffer = new Uint8Array(Math.min(remaining, bufferSize));
        const byteCount = await read(reader, { position, buffer });

        assert(byteCount <= remaining);
        position += byteCount;
        assert(position <= endPosition, `we went past the end of the file`);

        assert(byteCount > 0, `unexpected end of file`);
        controller.enqueue(buffer.subarray(0, byteCount));
      },
    });
  }
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
  // we can't assume that if data is already a ReadableStream that it has
  // Uint8Array chunks, so we still need to wrap it.

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
      if (typeof next.value === "string") {
        encoder ??= new TextEncoder();
        controller.enqueue(encoder.encode(next.value));
      } else if (next.value !== undefined) {
        assert(
          next.value instanceof Uint8Array,
          `expected Uint8Array or string`,
        );
        controller.enqueue(next.value);
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
