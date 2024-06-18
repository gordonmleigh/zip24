import assert from "node:assert";
import { text } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import {
  CompressionMethod,
  DosFileAttributes,
  UnixFileAttributes,
  ZipFormatError,
} from "../common.js";
import type { ZipEntryCompressionInfo } from "../internal/directory-entry.js";
import type { ByteStream } from "../internal/streams.js";
import { asyncIterable } from "../testing/data.js";
import { ZipEntryReader, decompress } from "./entry-reader.js";

describe("base/entry-reader", () => {
  describe("ZipEntryReader", () => {
    describe("isDirectory", () => {
      it("returns true if the entry is a unix directory", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isDirectory, true);
      });

      it("returns false if the entry is a unix file", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isDirectory, false);
      });

      it("returns true if the entry is a dos directory", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isDirectory, true);
      });

      it("returns false if the entry is a dos file", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isDirectory, false);
      });

      it("returns true if the entry path ends with a slash", () => {
        const entry = new ZipEntryReader();
        entry.path = "directory/";

        assert.strictEqual(entry.isDirectory, true);
      });
    });

    describe("isFile", () => {
      it("returns false if the entry is a unix directory", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isFile, false);
      });

      it("returns true if the entry is a unix file", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isFile, true);
      });

      it("returns false if the entry is a dos directory", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isFile, false);
      });

      it("returns true if the entry is a dos file", () => {
        const entry = new ZipEntryReader();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isFile, true);
      });

      it("returns false if the entry path ends with a slash", () => {
        const entry = new ZipEntryReader();
        entry.path = "directory/";

        assert.strictEqual(entry.isFile, false);
      });
    });

    describe("uncompressedData", () => {
      it("throws if accessed before initialization", () => {
        const entry = new ZipEntryReader();

        assert.throws(() => entry.uncompressedData);
      });

      it("returns the previously set value", async () => {
        const entry = new ZipEntryReader();
        entry.uncompressedData = asyncIterable`hello world`;

        const result = await text(entry.uncompressedData);
        assert.strictEqual(result, "hello world");
      });
    });

    describe("createReadableStream()", () => {
      it("returns a ReadableStream for the uncompressedData", async () => {
        const entry = new ZipEntryReader();
        entry.uncompressedData = asyncIterable`Bonjour le monde !`;

        const readableStream = entry.createReadableStream();
        assert(readableStream instanceof ReadableStream);

        const result = await text(readableStream);
        assert.strictEqual(result, "Bonjour le monde !");
      });
    });

    describe("toBuffer()", () => {
      it("returns a UInt8Array for the uncompressedData", async () => {
        const entry = new ZipEntryReader();
        entry.uncompressedData = asyncIterable`Hallo, Welt!`;

        const buffer = await entry.toBuffer();

        const result = Buffer.from(buffer).toString();
        assert.strictEqual(result, "Hallo, Welt!");
      });
    });

    describe("toText()", () => {
      it("returns a decoded string for the uncompressedData", async () => {
        const entry = new ZipEntryReader();
        entry.uncompressedData = asyncIterable`¡Hola Mundo! 🥺`;

        const result = await entry.toText();
        assert.strictEqual(result, "¡Hola Mundo! 🥺");
      });
    });

    describe("[Symbol.asyncIterator]()", () => {
      it("returns an iterator for the uncompressedData", async () => {
        const entry = new ZipEntryReader();
        entry.uncompressedData = asyncIterable`one ${1} two ${2}`;

        const iterator = entry[Symbol.asyncIterator]();

        const result1 = await iterator.next();
        assert(!result1.done);
        assert.strictEqual(result1.value.toString(), "one ");

        const result2 = await iterator.next();
        assert(!result2.done);
        assert.strictEqual(result2.value.toString(), "1");

        const result3 = await iterator.next();
        assert(!result3.done);
        assert.strictEqual(result3.value.toString(), " two ");

        const result4 = await iterator.next();
        assert(!result4.done);
        assert.strictEqual(result4.value.toString(), "2");

        const result5 = await iterator.next();
        assert.strictEqual(result5.done, true);
        assert.strictEqual(result5.value, undefined);
      });
    });
  });

  describe("decompress", () => {
    it("falls back to passing through the input for CompressionMethod.Stored", async () => {
      const entry: ZipEntryCompressionInfo = {
        crc32: 222957957,
        compressionMethod: CompressionMethod.Stored,
        compressedSize: 11,
        uncompressedSize: 11,
      };

      const input = asyncIterable`hello world`;

      const output = await text(decompress(entry, input, {}));
      assert.strictEqual(output, "hello world");
    });

    it("uses the correct algorithm", async () => {
      const entry: ZipEntryCompressionInfo = {
        crc32: 222957957,
        compressionMethod: CompressionMethod.Deflate,
        compressedSize: 11,
        uncompressedSize: 11,
      };

      // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
      const algorithm = mock.fn(async function* (input: ByteStream) {
        yield Buffer.from("hello world");
      });

      const input = asyncIterable`hello fred`;

      const output = await text(
        decompress(entry, input, {
          [CompressionMethod.Deflate]: algorithm,
        }),
      );
      assert.strictEqual(output, "hello world");
    });

    it("uses the passed algorithm if provided and compression method is Stored", async () => {
      const entry: ZipEntryCompressionInfo = {
        crc32: 222957957,
        compressionMethod: CompressionMethod.Stored,
        compressedSize: 11,
        uncompressedSize: 11,
      };

      // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
      const algorithm = mock.fn(async function* (input: ByteStream) {
        yield Buffer.from("hello world");
      });

      const input = asyncIterable`hello fred`;

      const output = await text(
        decompress(entry, input, {
          [CompressionMethod.Stored]: algorithm,
        }),
      );
      assert.strictEqual(output, "hello world");
    });

    it("throws if compressionMethod is unknown", () => {
      const entry: ZipEntryCompressionInfo = {
        crc32: 222957957,
        compressionMethod: CompressionMethod.Deflate,
        compressedSize: 11,
        uncompressedSize: 11,
      };

      // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
      const algorithm = mock.fn(async function* (input: ByteStream) {
        yield Buffer.from("hello world");
      });

      const input = asyncIterable`hello fred`;

      assert.rejects(
        text(decompress(entry, input, {})),
        (error) =>
          error instanceof ZipFormatError &&
          error.message === `unknown compression method 8`,
      );
    });

    it("throws if uncompressedSize is wrong", () => {
      const entry: ZipEntryCompressionInfo = {
        crc32: 222957957,
        compressionMethod: CompressionMethod.Stored,
        compressedSize: 11,
        uncompressedSize: 22,
      };

      const input = asyncIterable`hello world`;

      assert.rejects(
        text(decompress(entry, input, {})),
        (error) =>
          error instanceof ZipFormatError &&
          error.message === `zip file is corrupt (file size mismatch)`,
      );
    });

    it("throws if crc32 is wrong", () => {
      const entry: ZipEntryCompressionInfo = {
        crc32: 1,
        compressionMethod: CompressionMethod.Stored,
        compressedSize: 11,
        uncompressedSize: 11,
      };

      const input = asyncIterable`hello world`;

      assert.rejects(
        text(decompress(entry, input, {})),
        (error) =>
          error instanceof ZipFormatError &&
          error.message === `zip file is corrupt (crc32 mismatch)`,
      );
    });
  });
});
