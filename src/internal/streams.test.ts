import assert from "node:assert";
import { describe, it, mock } from "node:test";
import {
  bufferFromIterable,
  identityStream,
  iterableFromRandomAccessReader,
  iterableFromReadableStream,
  mapIterable,
  maxChunkSize,
  readableStreamFromIterable,
  textFromIterable,
  type RandomAccessReadOptions,
  type RandomAccessReadResult,
} from "./streams.js";

describe("iterableFromReadableStream", () => {
  it("creates an iterable that reads all chunks", async () => {
    const stream = new ReadableStream({
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
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("one,"));
        controller.enqueue(Buffer.from("two,"));
        controller.enqueue(Buffer.from("three,"));
        controller.close();
      },
    });

    // early versions of ReadableStream don't have Symbol.asyncIterable, so
    // simulate that
    const interceptedStream = new Proxy(stream, {
      has(target, property) {
        if (property === Symbol.asyncIterator) {
          return false;
        }
        return property in target;
      },
    });

    const iterable = iterableFromReadableStream(interceptedStream);
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

describe("mapIterable", () => {
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
