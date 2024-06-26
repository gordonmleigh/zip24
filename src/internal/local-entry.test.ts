import assert from "node:assert";
import { text } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import { assertBufferEqual } from "../testing/assert.js";
import {
  asyncIterable,
  bigUint,
  cp437,
  data,
  dosDate,
  longUint,
  shortUint,
  utf8,
  utf8length,
} from "../testing/data.js";
import { ZipFormatError, ZipSignatureError } from "./errors.js";
import {
  CompressionMethod,
  GeneralPurposeFlags,
  ZipVersion,
} from "./field-types.js";
import {
  compressEntry,
  decompressEntry,
  readLocalHeaderSize,
  writeDataDescriptor32,
  writeDataDescriptor64,
  writeLocalHeader,
} from "./local-entry.js";
import type {
  CompressionInfoFields,
  DataDescriptor,
  RawLocalHeader,
} from "./records.js";
import { bufferFromIterable, type ByteStream } from "./streams.js";

describe("readLocalHeaderSize", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      /* 00 +04 */ "ffffffff", // signature  (0x04034b50)
      /* 04 +02 */ "1500", // version needed (21 = 2.1)
      /* 06 +02 */ "4100", // flags
      /* 08 +02 */ "0800", // compression method (8 = DEFLATE)
      /* 10 +02 */ "6a51", // last mod file time (10:11:20)
      /* 12 +02 */ "a656", // last mod file date, (2023-05-06)
      /* 14 +04 */ "12345678", // crc-32
      /* 18 +04 */ "87654321", // compressed size
      /* 22 +04 */ "12348765", // uncompressed size
      /* 26 +02 */ "0800", // file name length
      /* 28 +02 */ "0000", // extra field length
      /* 30 +08 */ cp437`ôöò/path`, // file name
      /* 38 +00 */ "", // extra field
    );

    assert.throws(
      () => {
        readLocalHeaderSize(buffer);
      },
      (error) => error instanceof ZipSignatureError,
    );
  });

  it("returns the total record length", () => {
    const buffer = data(
      "787cdb53a824260cbe32f44f795ac791",
      "9cb2a9d1be27c02c893728b7456ace9f", // nonsense (32 bytes)

      /* 00 +04 */ "504b0304", // signature  (0x04034b50)
      /* 04 +02 */ "1500", // version needed (21 = 2.1)
      /* 06 +02 */ "4100", // flags
      /* 08 +02 */ "0800", // compression method (8 = DEFLATE)
      /* 10 +02 */ "6a51", // last mod file time (10:11:20)
      /* 12 +02 */ "a656", // last mod file date, (2023-05-06)
      /* 14 +04 */ "12345678", // crc-32
      /* 18 +04 */ "87654321", // compressed size
      /* 22 +04 */ "12348765", // uncompressed size
      /* 26 +02 */ "0800", // file name length
      /* 28 +02 */ "0d00", // extra field length
      /* 30 +08 */ cp437`ôöò/path`, // file name

      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0900", // size: 9 bytes
      "01", // version
      "4311773a", // crc of "world"
      utf8`🥺`, // data
    );

    const result = readLocalHeaderSize(buffer, 32);
    assert.strictEqual(result, 51);
  });
});

describe("decompressEntry", () => {
  it("falls back to passing through the input for CompressionMethod.Stored", async () => {
    const entry: CompressionInfoFields = {
      crc32: 222957957,
      compressionMethod: CompressionMethod.Stored,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    const input = asyncIterable`hello world`;

    const output = await text(decompressEntry(entry, input, {}));
    assert.strictEqual(output, "hello world");
  });

  it("uses the correct algorithm", async () => {
    const entry: CompressionInfoFields = {
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
      decompressEntry(entry, input, {
        [CompressionMethod.Deflate]: algorithm,
      }),
    );
    assert.strictEqual(output, "hello world");
  });

  it("uses the passed algorithm if provided and compression method is Stored", async () => {
    const entry: CompressionInfoFields = {
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
      decompressEntry(entry, input, {
        [CompressionMethod.Stored]: algorithm,
      }),
    );
    assert.strictEqual(output, "hello world");
  });

  it("throws if compressionMethod is unknown", async () => {
    const entry: CompressionInfoFields = {
      crc32: 222957957,
      compressionMethod: CompressionMethod.Deflate,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    const input = asyncIterable`hello fred`;

    await assert.rejects(
      text(decompressEntry(entry, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `unknown compression method 8`,
    );
  });

  it("throws if uncompressedSize is wrong", async () => {
    const entry: CompressionInfoFields = {
      crc32: 222957957,
      compressionMethod: CompressionMethod.Stored,
      compressedSize: 11,
      uncompressedSize: 22,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(decompressEntry(entry, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `zip file is corrupt (file size mismatch)`,
    );
  });

  it("throws if crc32 is wrong", async () => {
    const entry: CompressionInfoFields = {
      crc32: 1,
      compressionMethod: CompressionMethod.Stored,
      compressedSize: 11,
      uncompressedSize: 11,
    };

    const input = asyncIterable`hello world`;

    await assert.rejects(
      text(decompressEntry(entry, input, {})),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `zip file is corrupt (crc32 mismatch)`,
    );
  });
});

describe("writeLocalHeader", () => {
  it("writes all the basic fields", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.Utf8Encoding,
    };

    const expected = data(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.Utf8Encoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(1234), // compressed size
      longUint(4321), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(0), // extra field length
      utf8`hello/world`, // file name
    );

    const result = writeLocalHeader(entry);

    assertBufferEqual(result, expected);
  });

  it("includes the extra field data if given", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.Utf8Encoding,
      extraField: utf8`random rubbish`,
    };

    const expected = data(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.Utf8Encoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(1234), // compressed size
      longUint(4321), // uncompressed size
      utf8length`hello/world`, // file name length
      utf8length`random rubbish`, // extra field length
      utf8`hello/world`, // file name
      utf8`random rubbish`, // extra field
    );

    const result = writeLocalHeader(entry);

    assertBufferEqual(result, expected);
  });

  it("masks size and crc32 fields when hasDataDescriptor flag is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.Utf8Encoding,
      extraField: utf8`random rubbish`,
    };

    const expected = data(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.Utf8Encoding), // version needed to extract
      shortUint(8), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(0), // crc32
      longUint(0), // compressed size
      longUint(0), // uncompressed size
      utf8length`hello/world`, // file name length
      utf8length`random rubbish`, // extra field length
      utf8`hello/world`, // file name
      utf8`random rubbish`, // extra field
    );

    const result = writeLocalHeader(entry);

    assertBufferEqual(result, expected);
  });

  it("writes zip64 field when zip64 option is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.Utf8Encoding,
    };

    const expected = data(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.Utf8Encoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(0xffff_ffff), // compressed size
      longUint(0xffff_ffff), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(20), // extra field length
      utf8`hello/world`, // file name

      // extra field
      shortUint(1), // tag
      shortUint(16), // data size
      bigUint(4321), // uncompressed size
      bigUint(1234), // compressed size
    );

    const result = writeLocalHeader(entry, { zip64: true });

    assertBufferEqual(result, expected);
  });

  it("appends zip64 field to existing extraField when zip64 option is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      extraField: utf8`hello`,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.Utf8Encoding,
    };

    const expected = data(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.Utf8Encoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(0xffff_ffff), // compressed size
      longUint(0xffff_ffff), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(25), // extra field length
      utf8`hello/world`, // file name

      // extra field
      utf8`hello`,

      shortUint(1), // tag
      shortUint(16), // data size
      bigUint(4321), // uncompressed size
      bigUint(1234), // compressed size
    );

    const result = writeLocalHeader(entry, { zip64: true });

    assertBufferEqual(result, expected);
  });

  it("writes masked zip64 field when zip64 option and hasDataDescriptor flag is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.Utf8Encoding,
    };

    const expected = data(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.Utf8Encoding), // version needed to extract
      shortUint(8), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(0), // crc32
      longUint(0xffff_ffff), // compressed size
      longUint(0xffff_ffff), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(20), // extra field length
      utf8`hello/world`, // file name

      // extra field
      shortUint(1), // tag
      shortUint(16), // data size
      bigUint(0), // uncompressed size
      bigUint(0), // compressed size
    );

    const result = writeLocalHeader(entry, { zip64: true });

    assertBufferEqual(result, expected);
  });
});

describe("writeDataDescriptor32", () => {
  it("writes all the fields", () => {
    const descriptor: DataDescriptor = {
      compressedSize: 987234,
      uncompressedSize: 9082734,
      crc32: 234780354,
    };

    const result = writeDataDescriptor32(descriptor);

    const expected = data(
      longUint(0x08074b50), // signature
      longUint(234780354), // crc32
      longUint(987234), // compressed size
      longUint(9082734), // uncompressed size
    );

    assertBufferEqual(result, expected);
  });
});

describe("writeDataDescriptor64", () => {
  it("writes all the fields", () => {
    const descriptor: DataDescriptor = {
      compressedSize: 987234,
      uncompressedSize: 9082734,
      crc32: 234780354,
    };

    const result = writeDataDescriptor64(descriptor);

    const expected = data(
      longUint(0x08074b50), // signature
      longUint(234780354), // crc32
      bigUint(987234), // compressed size
      bigUint(9082734), // uncompressed size
    );

    assertBufferEqual(result, expected);
  });
});

describe("compressEntry", () => {
  it("falls back to passing through the input for CompressionMethod.Stored", async () => {
    const dataDescriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const input = asyncIterable`hello world`;

    const output = await text(
      compressEntry(CompressionMethod.Stored, {}, dataDescriptor, input, {}),
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
      compressEntry(CompressionMethod.Deflate, {}, dataDescriptor, input, {
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
      compressEntry(CompressionMethod.Stored, {}, dataDescriptor, input, {
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
      text(
        compressEntry(CompressionMethod.Deflate, {}, dataDescriptor, input, {}),
      ),
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
        compressEntry(
          CompressionMethod.Stored,
          check,
          dataDescriptor,
          input,
          {},
        ),
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
        compressEntry(
          CompressionMethod.Stored,
          check,
          dataDescriptor,
          input,
          {},
        ),
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
        compressEntry(
          CompressionMethod.Stored,
          check,
          dataDescriptor,
          input,
          {},
        ),
      ),
      (error) =>
        error instanceof ZipFormatError &&
        error.message === `compressedSize was supplied but is invalid`,
    );
  });
});
