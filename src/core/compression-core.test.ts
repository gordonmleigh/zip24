import assert from "node:assert";
import { text } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import { asyncIterable } from "../test-util/data.js";
import { bufferFromIterable, type ByteStream } from "../util/streams.js";
import {
  CompressionMethod,
  compress,
  decompress,
  type DataDescriptor,
} from "./compression-core.js";
import { ZipFormatError } from "./errors.js";

describe("compress", () => {
  it("falls back to passing through the input for CompressionMethod.Stored", async () => {
    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const input = asyncIterable`hello world`;

    const output = await text(
      compress(CompressionMethod.Stored, {}, dataDescriptor, input, {}),
    );

    assert.strictEqual(output, "hello world");
    assert.strictEqual(dataDescriptor.compressedSize, 11);
    assert.strictEqual(dataDescriptor.uncompressedSize, 11);
    assert.strictEqual(dataDescriptor.crc32, 222957957);
  });

  it("uses the correct algorithm", async () => {
    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const algorithm = mock.fn(async function* (input: ByteStream) {
      // `compressEntry` expects the algorithm to consume the input
      await bufferFromIterable(input);
      yield Buffer.from("hello fred");
    });

    const input = asyncIterable`hello world`;

    const output = await text(
      compress(CompressionMethod.Deflate, {}, dataDescriptor, input, {
        [CompressionMethod.Deflate]: algorithm,
      }),
    );

    assert.strictEqual(algorithm.mock.callCount(), 1);
    assert.strictEqual(output, "hello fred");
    assert.strictEqual(dataDescriptor.compressedSize, 10);
    assert.strictEqual(dataDescriptor.uncompressedSize, 11);
    assert.strictEqual(dataDescriptor.crc32, 222957957);
  });

  it("uses the passed algorithm if provided and compression method is Stored", async () => {
    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const algorithm = mock.fn(async function* (input: ByteStream) {
      // `compressEntry` expects the algorithm to consume the input
      await bufferFromIterable(input);
      yield Buffer.from("hello fred");
    });

    const input = asyncIterable`hello world`;

    const output = await text(
      compress(CompressionMethod.Stored, {}, dataDescriptor, input, {
        [CompressionMethod.Stored]: algorithm,
      }),
    );

    assert.strictEqual(algorithm.mock.callCount(), 1);
    assert.strictEqual(output, "hello fred");
    assert.strictEqual(dataDescriptor.compressedSize, 10);
    assert.strictEqual(dataDescriptor.uncompressedSize, 11);
    assert.strictEqual(dataDescriptor.crc32, 222957957);
  });

  it("throws if compressionMethod is unknown", async () => {
    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(compress(CompressionMethod.Deflate, {}, dataDescriptor, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `unknown compression method 8`,
    );
  });

  it("throws if uncompressedSize is wrong", async () => {
    const check: Partial<DataDescriptor> = {
      uncompressedSize: 3,
    };

    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(
        compress(CompressionMethod.Stored, check, dataDescriptor, input, {}),
      ),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `uncompressedSize was supplied but is invalid`,
    );
  });

  it("throws if crc32 is wrong", async () => {
    const check: Partial<DataDescriptor> = {
      crc32: 3,
    };

    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(
        compress(CompressionMethod.Stored, check, dataDescriptor, input, {}),
      ),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `crc32 was supplied but is invalid`,
    );
  });

  it("throws if compressedSize is wrong", async () => {
    const check: Partial<DataDescriptor> = {
      compressedSize: 3,
    };

    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(
        compress(CompressionMethod.Stored, check, dataDescriptor, input, {}),
      ),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `compressedSize was supplied but is invalid`,
    );
  });
});

describe("decompress", () => {
  it("falls back to passing through the input for CompressionMethod.Stored", async () => {
    const entry: DataDescriptor = {
      crc32: 222957957,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    const input = asyncIterable`hello world`;

    const output = await text(
      decompress(CompressionMethod.Stored, entry, input, {}),
    );
    assert.strictEqual(output, "hello world");
  });

  it("uses the correct algorithm", async () => {
    const entry: DataDescriptor = {
      crc32: 222957957,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
    const algorithm = mock.fn(async function* (input: ByteStream) {
      yield Buffer.from("hello world");
    });

    const input = asyncIterable`hello fred`;

    const output = await text(
      decompress(CompressionMethod.Deflate, entry, input, {
        [CompressionMethod.Deflate]: algorithm,
      }),
    );
    assert.strictEqual(output, "hello world");
  });

  it("uses the passed algorithm if provided and compression method is Stored", async () => {
    const entry: DataDescriptor = {
      crc32: 222957957,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
    const algorithm = mock.fn(async function* (input: ByteStream) {
      yield Buffer.from("hello world");
    });

    const input = asyncIterable`hello fred`;

    const output = await text(
      decompress(CompressionMethod.Stored, entry, input, {
        [CompressionMethod.Stored]: algorithm,
      }),
    );
    assert.strictEqual(output, "hello world");
  });

  it("throws if compressionMethod is unknown", async () => {
    const entry: DataDescriptor = {
      crc32: 222957957,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    const input = asyncIterable`hello fred`;

    await assert.rejects(
      text(decompress(CompressionMethod.Deflate, entry, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `unknown compression method 8`,
    );
  });

  it("throws if uncompressedSize is wrong", async () => {
    const entry: DataDescriptor = {
      crc32: 222957957,
      compressedSize: 11,
      uncompressedSize: 22,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(decompress(CompressionMethod.Stored, entry, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `zip file is corrupt (file size mismatch)`,
    );
  });

  it("throws if crc32 is wrong", async () => {
    const entry: DataDescriptor = {
      crc32: 1,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(decompress(CompressionMethod.Stored, entry, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `zip file is corrupt (crc32 mismatch)`,
    );
  });
});
