/* eslint-disable n/no-unsupported-features/node-builtins */
import { assert } from "./assert.js";

const DefaultChunkSize = 1024 ** 2; // 1 MB

export type AnyIterable<T> = AsyncIterable<T> | Iterable<T>;
export type ByteStream = AnyIterable<Uint8Array>;

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
  read: (
    options: RandomAccessReadOptions,
  ) => PromiseLike<RandomAccessReadResult>;
};

type RandomAccessReaderSourceOptions = {
  byteLength?: number;
  chunkSize?: number;
  position?: number;
};

export async function* iterableFromReadableStream(
  stream: ReadableStream,
): AsyncGenerator<Uint8Array, undefined, undefined> {
  // prevent narrowing to `never` after this block (using `as any`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Symbol.asyncIterator in (stream as any)) {
    yield* stream;
    return;
  }

  const reader = stream.getReader();

  try {
    for (;;) {
      const result = await reader.read();

      if (result.value !== undefined) {
        assert(result.value instanceof Uint8Array, `expected byte array`);
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
  const { chunkSize = DefaultChunkSize, byteLength } = options;
  let { position = 0 } = options;
  let bytesRead = 0;

  for (;;) {
    const bufferSize =
      byteLength === undefined
        ? chunkSize
        : Math.min(byteLength - bytesRead, chunkSize);

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
      bytesRead += result.bytesRead;
    } else {
      return;
    }
  }
}

export function readableStreamFromIterable(
  input: ByteStream,
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
  input: ByteStream,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }

  const byteLength = chunks.reduce((a, x) => a + x.byteLength, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

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

export async function* identityStream<Input>(
  input: AnyIterable<Input>,
): AsyncGenerator<Input> {
  for await (const element of input) {
    yield element;
  }
}

function getAsyncIterator<T>(
  iterable: AnyIterable<T>,
): AsyncIterator<T> | Iterator<T> {
  const input = iterable as Partial<AsyncIterable<Uint8Array>> &
    Partial<Iterable<Uint8Array>>;

  if (Symbol.asyncIterator in input) {
    return (input as AsyncIterable<T>)[Symbol.asyncIterator]();
  }
  return (input as Iterable<T>)[Symbol.iterator]();
}
