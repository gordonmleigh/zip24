import assert from "node:assert";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, it } from "node:test";
import { ZipFormatError } from "../exports/errors.ts";
import { assertBufferEqual } from "../test-util/assert.ts";
import { data, utf8 } from "../test-util/data.ts";
import {
  normalizeDataSource,
  randomAccessReaderFromBuffer,
  read,
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
});
