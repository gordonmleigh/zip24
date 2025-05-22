import assert from "node:assert";
import { Readable } from "node:stream";
import { buffer, text } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import { ZipFormatError } from "../exports/errors.ts";
import { assertBufferEqual, assertInstanceOf } from "../test-util/assert.ts";
import { data, utf8 } from "../test-util/data.ts";
import {
  fallbackReadableStreamFromAsyncIterable,
  normalizeDataSource,
  randomAccessReaderFromBuffer,
  read,
  readableStreamFromDeferred,
  readableStreamFromIterable,
} from "./streams.ts";

describe("util/streams", () => {
  describe("function read()", () => {
    it("returns at least minLength", async () => {
      const reader = randomAccessReaderFromBuffer(utf8`ABCDEFGHIJKLMNOP`);
      const buffer = new Uint8Array(100);
      const count = await read(reader, { buffer, position: 2, minLength: 5 });

      assert.strictEqual(count, 14);
      const text = new TextDecoder().decode(buffer.subarray(0, count));
      assert.strictEqual(text, "CDEFGHIJKLMNOP");
    });

    it("throws ZipFormatError if minLength is longer than available data", async () => {
      const reader = randomAccessReaderFromBuffer(utf8`ABCDEFGHIJKLMNOP`);
      const buffer = new Uint8Array(100);

      await assert.rejects(
        () => read(reader, { buffer, position: 2, minLength: 50 }),
        (error) => error instanceof ZipFormatError,
      );
    });

    it("successfully reads nothing if minLength is zero", async () => {
      const reader = randomAccessReaderFromBuffer(utf8`ABCDEFGHIJKLMNOP`);
      const buffer = new Uint8Array(100);

      const count = await read(reader, { buffer, position: 16, minLength: 0 });
      assert.strictEqual(count, 0);
    });
  });

  describe("function normalizeDataSource()", () => {
    it("makes an empty stream from undefined", async () => {
      const output = normalizeDataSource(undefined);
      const iterator = output[Symbol.asyncIterator]();
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

    it("iterates an Iterable of Uint8Array", async () => {
      const output = await buffer(
        normalizeDataSource([
          Buffer.from("one,"),
          Buffer.from("two,"),
          Buffer.from("three,"),
        ]),
      );

      const expected = utf8`one,two,three,`;

      assertBufferEqual(output, expected);
    });

    it("iterates an Iterable of string", async () => {
      const output = await buffer(
        normalizeDataSource(["one,", "two,", "three,"]),
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
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(utf8`one,`);
          controller.enqueue(utf8`two,`);
          controller.enqueue(utf8`three,`);
          controller.close();
        },
      });

      const output = await buffer(normalizeDataSource(stream));
      const expected = utf8`one,two,three,`;

      assertBufferEqual(output, expected);
    });

    it("converts ReadableStream<string> to ReadableStream<Uint8Array>", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue("one,");
          controller.enqueue("two,");
          controller.enqueue("three,");
          controller.close();
        },
      });

      const output = await buffer(normalizeDataSource(stream));
      const expected = utf8`one,two,three,`;

      assertBufferEqual(output, expected);
    });
  });

  describe("function fallbackReadableStreamFromAsyncIterable()", () => {
    it("converts an AsyncIterable to a ReadableStream", async () => {
      const input = Readable.from([
        Buffer.from("one,"),
        Buffer.from("two,"),
        Buffer.from("three"),
      ]);

      const readable = fallbackReadableStreamFromAsyncIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const output = await text(readable);

      assert.strictEqual(output, "one,two,three");
    });

    it("propagates cancel", async () => {
      const returnFn = mock.fn(
        async (reason: unknown) => ({ done: true, value: undefined }) as const,
      );

      const input: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },

        next: async () => ({ done: true, value: undefined }),
        return: returnFn,
      };

      const readable = fallbackReadableStreamFromAsyncIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const reader = readable.getReader();

      const reason = Symbol();
      await reader.cancel(reason);

      assert.strictEqual(returnFn.mock.callCount(), 1);
      assert.strictEqual(returnFn.mock.calls[0]?.arguments[0], reason);
    });

    it("accepts iterators with no return() method", async () => {
      const input: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },

        next: async () => ({ done: true, value: undefined }),
      };

      const readable = fallbackReadableStreamFromAsyncIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const reader = readable.getReader();

      const reason = Symbol();
      await reader.cancel(reason);
    });

    it("throws TypeError if the iterable returns something other than an object", async () => {
      const input: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },

        next: async () => 2 as any,
      };

      const readable = fallbackReadableStreamFromAsyncIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const reader = readable.getReader();

      await assert.rejects(
        () => reader.read(),
        (error) =>
          error instanceof TypeError &&
          "code" in error &&
          error.code === "ERR_INVALID_STATE",
      );
    });
  });

  describe("function readableStreamFromIterable()", () => {
    it("converts an Iterable to a ReadableStream", async () => {
      const input = [
        Buffer.from("one,"),
        Buffer.from("two,"),
        Buffer.from("three"),
      ];

      const readable = readableStreamFromIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const output = await text(readable);

      assert.strictEqual(output, "one,two,three");
    });

    it("propagates cancel", async () => {
      const returnFn = mock.fn(
        (reason: unknown) => ({ done: true, value: undefined }) as const,
      );

      const input: IterableIterator<Uint8Array> = {
        [Symbol.iterator]() {
          return this;
        },

        next: () => ({ done: true, value: undefined }),
        return: returnFn,
      };

      const readable = readableStreamFromIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const reader = readable.getReader();

      const reason = Symbol();
      await reader.cancel(reason);

      assert.strictEqual(returnFn.mock.callCount(), 1);
      assert.strictEqual(returnFn.mock.calls[0]?.arguments[0], reason);
    });

    it("accepts iterators with no return() method", async () => {
      const input: IterableIterator<Uint8Array> = {
        [Symbol.iterator]() {
          return this;
        },

        next: () => ({ done: true, value: undefined }),
      };

      const readable = readableStreamFromIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const reader = readable.getReader();

      const reason = Symbol();
      await reader.cancel(reason);
    });

    it("throws TypeError if the iterable returns something other than an object", async () => {
      const input: IterableIterator<Uint8Array> = {
        [Symbol.iterator]() {
          return this;
        },

        next: () => 2 as any,
      };

      const readable = readableStreamFromIterable(input);
      assertInstanceOf(readable, ReadableStream);

      const reader = readable.getReader();

      await assert.rejects(
        () => reader.read(),
        (error) =>
          error instanceof TypeError &&
          "code" in error &&
          error.code === "ERR_INVALID_STATE",
      );
    });

    describe("function readableStreamFromDeferred()", () => {
      it("returns the correct data", async () => {
        const source = Promise.resolve(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.enqueue(Buffer.from("hello "));
              controller.enqueue(Buffer.from("world"));
              controller.close();
            },
          }),
        );

        const result = readableStreamFromDeferred(source);
        assertInstanceOf(result, ReadableStream);

        const data = await text(result);
        assert.strictEqual(data, "hello world");
      });

      it("propagates cancel", async () => {
        const cancel = mock.fn((reason: unknown) => {});

        const source = Promise.resolve(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.enqueue(Buffer.from("hello "));
              controller.enqueue(Buffer.from("world"));
              controller.close();
            },
            cancel,
          }),
        );

        const result = readableStreamFromDeferred(source);
        assertInstanceOf(result, ReadableStream);

        const reader = result.getReader();

        const reason = Symbol();
        await reader.cancel(reason);

        assert.strictEqual(cancel.mock.callCount(), 1);
        assert.strictEqual(cancel.mock.calls[0]?.arguments[0], reason);
      });
    });
  });
});
