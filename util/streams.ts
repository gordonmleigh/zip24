import { ZipFormatError } from "../exports/errors.ts";
import { assert } from "./assert.ts";
import { computeCrc32 } from "./crc32.ts";

export type AnyIterable<T> = AsyncIterable<T> | Iterable<T>;
export type ByteStream = AnyIterable<Uint8Array>;
export type ByteSource = AnyIterable<Uint8Array> | Uint8Array;
export type ByteSourceProvider = Uint8Array | (() => ByteSource);

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
  length: number;
};

export class RandomAccessReaderStream extends ReadableStream<Uint8Array> {
  public constructor(options: RandomAccessReaderStreamOptions) {
    const { bufferSize = 128 * 1024, reader } = options;

    let position = options.startPosition;
    const endPosition = position + options.length;

    super({
      pull: async (controller) => {
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

export function normalizeByteSource(
  data: ByteSource,
): ReadableStream<Uint8Array> {
  if (data instanceof ReadableStream) {
    return data as ReadableStream<Uint8Array>;
  }
  if (data instanceof Uint8Array) {
    return readableStreamFromIterable([data]);
  }
  if (Symbol.iterator in data) {
    return readableStreamFromIterable(data);
  }
  return readableStreamFromAsyncIterable(data);
}

export function normalizeByteSourceProvider(
  provider: ByteSourceProvider,
): () => ReadableStream<Uint8Array> {
  if (provider instanceof Uint8Array) {
    return () => normalizeByteSource(provider);
  }
  return () => normalizeByteSource(provider());
}

export function normalizeDataSource(
  data: DataSource | undefined,
): ReadableStream<Uint8Array> {
  // we can't assume that if data is already a ReadableStream that it has
  // Uint8Array chunks, so we still need to wrap it.

  if (!data) {
    return readableStreamFromIterable([]);
  }
  if (typeof data === "string") {
    return readableStreamFromIterable([new TextEncoder().encode(data)]);
  }
  if (data instanceof Uint8Array) {
    return readableStreamFromIterable([data]);
  }

  let encoder: TextEncoder | undefined;
  if (Symbol.iterator in data) {
    return readableStreamFromIterable(
      (function* () {
        for (const chunk of data) {
          if (typeof chunk === "string") {
            encoder ??= new TextEncoder();
            yield encoder.encode(chunk);
          } else {
            yield chunk;
          }
        }
      })(),
    );
  }
  return readableStreamFromAsyncIterable(
    (async function* () {
      for await (const chunk of data) {
        if (typeof chunk === "string") {
          encoder ??= new TextEncoder();
          yield encoder.encode(chunk);
        } else {
          yield chunk;
        }
      }
    })(),
  );
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

export function readableStreamFromDeferred<T>(
  promise: PromiseLike<ReadableStream<T>>,
): ReadableStream<T> {
  let reader: ReadableStreamDefaultReader<T>;

  return new ReadableStream<T>({
    start: async () => {
      const readable = await promise;
      reader = readable.getReader();
    },

    pull: async (controller) => {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },

    cancel: async (reason) => {
      await reader.cancel(reason);
    },
  });
}

/**
 * This isn't available everywhere yet.
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/from_static}
 */
function readableStreamFromAsyncIterable<T>(
  asyncIterable: AsyncIterable<T>,
): ReadableStream<T> {
  // use the provided version if it exists
  if ("from" in ReadableStream && typeof ReadableStream.from === "function") {
    return (ReadableStream.from as typeof readableStreamFromAsyncIterable)(
      asyncIterable,
    );
  }

  // Spec: https://streams.spec.whatwg.org/#readable-stream-from-iterable
  // 2.
  const iteratorRecord = asyncIterable[Symbol.asyncIterator]();
  // 4.
  const pullAlgorithm: UnderlyingDefaultSource<T>["pull"] = async (
    controller,
  ) => {
    // 4.1 - 4.4
    const iterResult = await iteratorRecord.next();
    // 4.4.1
    assertIteratorResultObject(iterResult);
    // 4.4.2
    if (iterResult.done) {
      // 4.4.3
      controller.close();
    } else {
      // 4.4.2
      controller.enqueue(iterResult.value);
    }
  };
  // 5.
  const cancelAlgorithm: UnderlyingDefaultSource<T>["cancel"] = async (
    reason,
  ) => {
    // 5.3
    if (iteratorRecord.return === undefined) {
      return;
    }
    // 5.5-5.7
    const iterResult = await iteratorRecord.return(reason);
    // 5.8
    assertIteratorResultObject(iterResult);
  };

  // 6.-7.
  return new ReadableStream<T>(
    {
      pull: pullAlgorithm,
      cancel: cancelAlgorithm,
    },
    { highWaterMark: 0 },
  );
}

/**
 * This is the synchronous analog of {@link readableStreamFromAsyncIterable}.
 */
function readableStreamFromIterable<T>(
  iterable: Iterable<T>,
): ReadableStream<T> {
  const iteratorRecord = iterable[Symbol.iterator]();

  const pullAlgorithm: UnderlyingDefaultSource<T>["pull"] = (controller) => {
    const iterResult = iteratorRecord.next();
    assertIteratorResultObject(iterResult);
    if (iterResult.done) {
      controller.close();
    } else {
      controller.enqueue(iterResult.value);
    }
  };
  const cancelAlgorithm: UnderlyingDefaultSource<T>["cancel"] = (reason) => {
    if (iteratorRecord.return === undefined) {
      return;
    }
    const iterResult = iteratorRecord.return(reason);
    assertIteratorResultObject(iterResult);
  };

  return new ReadableStream<T>(
    {
      pull: pullAlgorithm,
      cancel: cancelAlgorithm,
    },
    { highWaterMark: 0 },
  );
}

function assertIteratorResultObject(value: unknown): asserts value is object {
  if (typeof value !== "object") {
    throw Object.assign(
      new TypeError(
        "The promise returned by the iterator.next() method must fulfill with an object",
      ),
      { code: "ERR_INVALID_STATE" },
    );
  }
}
