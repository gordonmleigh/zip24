import assert from "node:assert";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import { assertBufferEqual } from "../testing/assert.js";
import { data, utf8 } from "../testing/data.js";
import { makeNonIterableReadableStream } from "../testing/util.js";
import {
  bufferFromIterable,
  getAsyncIterator,
  identityStream,
  iterableFromRandomAccessReader,
  iterableFromReadableStream,
  mapIterable,
  maxChunkSize,
  normalizeDataSource,
  readableStreamFromIterable,
  textFromIterable,
  type RandomAccessReadOptions,
  type RandomAccessReadResult,
} from "./streams.js";

describe("iterableFromReadableStream", () => {
  it("creates an iterable that reads all chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("one,"));
        controller.enqueue(Buffer.from("two,"));
        controller.enqueue(Buffer.from("three,"));
        controller.close();
      },
    });

    const iterable = iterableFromReadableStream(stream);
    const data: Uint8Array[] = [];

    for await (const chunk of iterable) {
      data.push(chunk);
    }

    assert.strictEqual(Buffer.concat(data).toString(), "one,two,three,");
  });

  it("works on stream without built-in iterable", async () => {
    const stream = makeNonIterableReadableStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from("one,"));
          controller.enqueue(Buffer.from("two,"));
          controller.enqueue(Buffer.from("three,"));
          controller.close();
        },
      }),
    );

    const iterable = iterableFromReadableStream(stream);
    const data: Uint8Array[] = [];

    for await (const chunk of iterable) {
      data.push(chunk);
    }

    assert.strictEqual(Buffer.concat(data).toString(), "one,two,three,");
  });
});

describe("iterableFromRandomAccessReader", () => {
  it("iterates through the whole reader", async () => {
    const data = Buffer.from("hello world!");

    const read = mock.fn(
      (options: RandomAccessReadOptions): Promise<RandomAccessReadResult> => {
        const length = Math.min(
          data.length - options.position,
          options.length ?? 5,
        );

        const chunk = data.subarray(
          options.position,
          options.position + length,
        );
        options.buffer.set(chunk, options.offset);

        return Promise.resolve({
          buffer: options.buffer,
          bytesRead: length,
        });
      },
    );

    const iterable = iterableFromRandomAccessReader({ read }, { chunkSize: 2 });

    const chunks: string[] = [];
    for await (const chunk of iterable) {
      chunks.push(Buffer.from(chunk).toString());
    }

    assert.deepStrictEqual(chunks, ["he", "ll", "o ", "wo", "rl", "d!"]);
  });

  it("iterates through a subset of the reader", async () => {
    const data = Buffer.from("hello world!");

    const read = mock.fn(
      (options: RandomAccessReadOptions): Promise<RandomAccessReadResult> => {
        const length = Math.min(
          data.length - options.position,
          options.length ?? 5,
        );

        const chunk = data.subarray(
          options.position,
          options.position + length,
        );
        options.buffer.set(chunk, options.offset);

        return Promise.resolve({
          buffer: options.buffer,
          bytesRead: length,
        });
      },
    );

    const iterable = iterableFromRandomAccessReader(
      { read },
      { chunkSize: 2, position: 4, byteLength: 4 },
    );

    const chunks: string[] = [];
    for await (const chunk of iterable) {
      chunks.push(Buffer.from(chunk).toString());
    }

    assert.deepStrictEqual(chunks, ["o ", "wo"]);
  });
});

describe("readableStreamFromIterable", () => {
  it("creates a ReadableStream that iterates an Iterable", async () => {
    const stream = readableStreamFromIterable(
      ["fred", "george", "ron"].map((x) => Buffer.from(x)),
    );

    const chunks: string[] = [];
    const reader = stream.getReader();

    for (;;) {
      const result = await reader.read();
      if (result.value !== undefined) {
        chunks.push(Buffer.from(result.value).toString());
      }
      if (result.done) {
        break;
      }
    }

    assert.deepStrictEqual(chunks, ["fred", "george", "ron"]);
  });

  it("creates a ReadableStream that iterates an AsyncIterable", async () => {
    const stream = readableStreamFromIterable(
      (async function* () {
        const chunks = ["fred", "george", "ron"];
        for (const chunk of chunks) {
          await Promise.resolve();
          yield Buffer.from(chunk);
        }
      })(),
    );

    const chunks: string[] = [];
    const reader = stream.getReader();

    for (;;) {
      const result = await reader.read();
      if (result.value !== undefined) {
        chunks.push(Buffer.from(result.value).toString());
      }
      if (result.done) {
        break;
      }
    }

    assert.deepStrictEqual(chunks, ["fred", "george", "ron"]);
  });

  it("calls iterator.return when the reader is cancelled", () => {
    const returnFunction = mock.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (error: unknown) => ({ done: true, value: undefined }) as const,
    );

    const stream = readableStreamFromIterable({
      [Symbol.iterator]: () => ({
        next: () => ({ done: true, value: undefined }),
        return: returnFunction,
      }),
    } satisfies Iterable<Uint8Array>);

    const reader = stream.getReader();
    const error = new Error("bang");
    reader.cancel(error);

    assert.strictEqual(returnFunction.mock.callCount(), 1);
    assert.strictEqual(returnFunction.mock.calls[0]?.arguments[0], error);
  });
});

describe("bufferFromIterable", () => {
  it("buffers all of the chunks", async () => {
    const buffer = await bufferFromIterable(
      (async function* () {
        const chunks = ["uno.", "dos.", "tres."];
        for (const chunk of chunks) {
          await Promise.resolve();
          yield Buffer.from(chunk);
        }
      })(),
    );

    assert.strictEqual(Buffer.from(buffer).toString(), "uno.dos.tres.");
  });
});

describe("textFromIterable", () => {
  it("decodes all of the chunks", async () => {
    const data = ["one", "1️⃣", "2️⃣", "3️⃣"].map((x) => Buffer.from(x));
    // chunk it up weird so that we can prove the utf-8 decoding works properly
    // (the glyphs are 7 bytes)
    const chunks = maxChunkSize(data, 3);
    const text = await textFromIterable(chunks);

    assert.strictEqual(text, "one1️⃣2️⃣3️⃣");
  });
});

describe("mapIterable", () => {
  it("maps each element in the source", async () => {
    const map = mock.fn((x: string) => x.toUpperCase());

    const source = (async function* () {
      const chunks = ["uno", "dos", "tres"];
      for (const chunk of chunks) {
        await Promise.resolve();
        yield chunk;
      }
    })();

    const iterable = mapIterable(source, map);

    const chunks: string[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }

    assert.strictEqual(map.mock.callCount(), 3);
    assert.strictEqual(map.mock.calls[0]?.arguments[0], "uno");
    assert.strictEqual(map.mock.calls[1]?.arguments[0], "dos");
    assert.strictEqual(map.mock.calls[2]?.arguments[0], "tres");

    assert.deepStrictEqual(chunks, ["UNO", "DOS", "TRES"]);
  });
});

describe("identityIterable", () => {
  it("returns each element in the source unchanged", async () => {
    const source = (async function* () {
      const chunks = ["uno", "dos", "tres"];
      for (const chunk of chunks) {
        await Promise.resolve();
        yield chunk;
      }
    })();

    const iterable = identityStream(source);

    const chunks: string[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }

    assert.deepStrictEqual(chunks, ["uno", "dos", "tres"]);
  });
});

describe("getAsyncIterator", () => {
  it("returns the async iterator for an async stream", () => {
    const iterator = Symbol();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
    const getIterator = mock.fn(() => iterator as any);

    const iterable = {
      [Symbol.asyncIterator]: getIterator,
    };

    const result = getAsyncIterator(iterable);

    assert.strictEqual(getIterator.mock.callCount(), 1);
    assert.strictEqual(result, iterator);
  });

  it("returns the sync iterator for a sync stream", () => {
    const iterator = Symbol();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
    const getIterator = mock.fn(() => iterator as any);

    const iterable = {
      [Symbol.iterator]: getIterator,
    };

    const result = getAsyncIterator(iterable);

    assert.strictEqual(getIterator.mock.callCount(), 1);
    assert.strictEqual(result, iterator);
  });

  it("returns the async iterator for a dual-mode stream", () => {
    const asyncIterator = Symbol();
    const syncIterator = Symbol();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
    const getAsyncIteratorMethod = mock.fn(() => asyncIterator as any);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
    const getSyncIteratorMethod = mock.fn(() => syncIterator as any);

    const iterable = {
      [Symbol.asyncIterator]: getAsyncIteratorMethod,
      [Symbol.iterator]: getSyncIteratorMethod,
    };

    const result = getAsyncIterator(iterable);

    assert.strictEqual(getAsyncIteratorMethod.mock.callCount(), 1);
    assert.strictEqual(getSyncIteratorMethod.mock.callCount(), 0);
    assert.strictEqual(result, asyncIterator);
  });

  it("throws if the value isn't iterable", () => {
    assert.throws(
      () => getAsyncIterator({} as AsyncIterable<unknown>),
      (error) =>
        error instanceof TypeError &&
        error.message === `value is neither AsyncIterable nor Iterable`,
    );
  });
});

describe("normalizeDataSource", () => {
  it("makes an empty stream from undefined", async () => {
    const output = normalizeDataSource(undefined);
    const iterator = getAsyncIterator(output);
    const result = await iterator.next();

    assert.strictEqual(result.done, true);
    assert.strictEqual(result.value, undefined);
  });

  it("encodes a string to utf-8", async () => {
    const output = await buffer(normalizeDataSource("😁"));
    const expected = data("f09f9881");
    assertBufferEqual(output, expected);
  });

  it("encodes a stream of strings to utf-8", async () => {
    const output = await buffer(
      normalizeDataSource(
        Readable.from([
          "to be, or not to be, that is the question",
          "😁",
          "日本語",
        ]),
      ),
    );

    const expected = data(
      utf8`to be, or not to be, that is the question`,
      "f09f9881",
      "e697a5e69cace8aa9e",
    );

    assertBufferEqual(output, expected);
  });

  it("iterates an AsyncIterable", async () => {
    const output = await buffer(
      normalizeDataSource(
        Readable.from([
          Buffer.from("one,"),
          Buffer.from("two,"),
          Buffer.from("three,"),
        ]),
      ),
    );

    const expected = utf8`one,two,three,`;

    assertBufferEqual(output, expected);
  });

  it("makes a stream from a buffer", async () => {
    const output = await buffer(normalizeDataSource(utf8`hello world`));
    const expected = utf8`hello world`;
    assertBufferEqual(output, expected);
  });

  it("iterates a ReadableStream", async () => {
    const stream = makeNonIterableReadableStream(
      new ReadableStream({
        start(controller) {
          controller.enqueue(utf8`one,`);
          controller.enqueue(utf8`two,`);
          controller.enqueue(utf8`three,`);
          controller.close();
        },
      }),
    );

    const output = await buffer(normalizeDataSource(stream));
    const expected = utf8`one,two,three,`;

    assertBufferEqual(output, expected);
  });

  it("converts ReadableStream<string> to ReadableStream<Uint8Array>", async () => {
    const stream = makeNonIterableReadableStream(
      new ReadableStream({
        start(controller) {
          controller.enqueue("one,");
          controller.enqueue("two,");
          controller.enqueue("three,");
          controller.close();
        },
      }),
    );

    const output = await buffer(normalizeDataSource(stream));
    const expected = utf8`one,two,three,`;

    assertBufferEqual(output, expected);
  });
});
