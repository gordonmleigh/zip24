/* eslint-disable n/no-unsupported-features/node-builtins */
import { hasExtraProperty } from "./assert.js";

const DefaultChunkSize = 1024 ** 2; // 1 MB

export type AnyIterable<T> = AsyncIterable<T> | Iterable<T>;
export type ByteSource = AnyIterable<Uint8Array>;

export type ByteSink = {
  close: () => PromiseLike<void> | void;
  write: (chunk: Uint8Array) => PromiseLike<void>;
};

export type RandomAccessReadOptions = {
  buffer: Uint8Array;
  offset?: number;
  length?: number;
  position: number;
};

export type RandomAccessReadResult = {
  bytesRead: number;
  buffer: Uint8Array;
};

export type RandomAccessReader = {
  close?: () => void | PromiseLike<void>;
  read: (
    options: RandomAccessReadOptions,
  ) => PromiseLike<RandomAccessReadResult>;
};

export type RandomAccessReaderSourceOptions = {
  byteLength?: number;
  chunkSize?: number;
  position?: number;
};

export type DataSource =
  | Uint8Array
  | string
  | AsyncIterable<string>
  | AsyncIterable<Uint8Array>
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  | ReadableStream<string>
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  | ReadableStream<Uint8Array>;

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

export async function* iterableFromReadableStream<T>(
  stream: ReadableStream<T>,
): AsyncGenerator<T, undefined, undefined> {
  // prevent narrowing to `never` after this block (using `as any`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (isAsyncIterable(stream as any)) {
    yield* stream;
    return;
  }

  const reader = stream.getReader();

  try {
    for (;;) {
      const result = await reader.read();

      if (result.value !== undefined) {
        yield result.value;
      }

      if (result.done) {
        break;
      }
    }
  } finally {
    await reader.cancel();
  }
}

export async function* iterableFromRandomAccessReader(
  reader: RandomAccessReader,
  options: RandomAccessReaderSourceOptions = {},
): AsyncGenerator<Uint8Array, undefined, undefined> {
  const byteLength = options.byteLength ?? Number.POSITIVE_INFINITY;
  const chunkSize = options.chunkSize ?? DefaultChunkSize;
  let position = options.position ?? 0;
  const endPosition = position + byteLength;

  for (;;) {
    const bufferSize = Math.min(chunkSize, endPosition - position);
    if (bufferSize === 0) {
      return;
    }

    const buffer = new Uint8Array(bufferSize);

    const result = await reader.read({
      buffer,
      position,
      length: bufferSize,
    });

    if (result.bytesRead > 0) {
      yield buffer.subarray(0, result.bytesRead);
      position += result.bytesRead;
    } else {
      return;
    }
  }
}

export async function* normalizeDataSource(
  data: DataSource | undefined,
): AsyncIterable<Uint8Array> {
  if (data === undefined) {
    return;
  }
  if (typeof data === "string") {
    yield new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    yield data;
  } else {
    const iterable = isAsyncIterable(data)
      ? data
      : iterableFromReadableStream<string | Uint8Array>(data);

    const encoder = new TextEncoder();

    yield* mapIterable(iterable, (chunk: string | Uint8Array) =>
      typeof chunk === "string" ? encoder.encode(chunk) : chunk,
    );
  }
}

export function readableStreamFromIterable(
  input: ByteSource,
): ReadableStream<Uint8Array> {
  const inputIterator = getAsyncIterator(input);

  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  return new ReadableStream({
    pull: async (controller) => {
      const result = await inputIterator.next();
      if (result.value !== undefined) {
        controller.enqueue(result.value as Uint8Array);
      }
      if (result.done) {
        controller.close();
      }
    },

    cancel: async (reason) => {
      await inputIterator.return?.(reason);
    },
  });
}

export async function bufferFromIterable(
  input: ByteSource,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for await (const chunk of input) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }

  const output = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

export async function textFromIterable(
  input: ByteSource,
  encoding?: string,
): Promise<string> {
  const decoder = new TextDecoder(encoding);
  let output = "";

  for await (const chunk of input) {
    output += decoder.decode(chunk, { stream: true });
  }

  output += decoder.decode();
  return output;
}

export async function* mapIterable<Input, Output>(
  input: AnyIterable<Input>,
  map: (input: Input) => Output | PromiseLike<Output>,
): AsyncGenerator<Output> {
  for await (const element of input) {
    yield await map(element);
  }
}

export async function* maxChunkSize(
  input: ByteSource,
  chunkSize: number,
): ByteSource {
  for await (const originalChunk of input) {
    for (
      let offset = 0;
      offset < originalChunk.byteLength;
      offset += chunkSize
    ) {
      yield originalChunk.subarray(
        offset,
        offset + Math.min(originalChunk.byteLength - offset, chunkSize),
      );
    }
  }
}

export async function* identityStream<Input>(
  input: AnyIterable<Input>,
): AsyncGenerator<Input> {
  for await (const element of input) {
    yield element;
  }
}

export function getAsyncIterator<T>(
  iterable: AnyIterable<T>,
): AsyncIterator<T> | Iterator<T> {
  if (isAsyncIterable(iterable)) {
    return iterable[Symbol.asyncIterator]();
  }
  if (isIterable(iterable)) {
    return iterable[Symbol.iterator]();
  }
  throw new TypeError(`value is neither AsyncIterable nor Iterable`);
}

export function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return hasExtraProperty(value, Symbol.asyncIterator);
}

export function isIterable(value: unknown): value is Iterable<unknown> {
  return hasExtraProperty(value, Symbol.iterator);
} /**
 * A function which can transform data from an async iterable.
 */

export type AsyncTransform = (
  input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
) => AsyncIterable<Uint8Array>;
