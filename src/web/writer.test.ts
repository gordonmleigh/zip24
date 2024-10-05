import assert from "node:assert";
import { buffer } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  ZipPlatform,
  ZipVersion,
} from "../common.js";
import { assertBufferEqual } from "../test-util/assert.js";
import {
  bigUint,
  cp437,
  cp437length,
  crc32,
  data,
  dosDate,
  longUint,
  mockAsyncTransform,
  shortUint,
  tinyUint,
  utf8,
  utf8length,
  utf8length32,
} from "../test-util/data.js";
import { computeCrc32 } from "../util/crc32.js";
import type { ByteSink } from "../util/streams.js";
import { defaultCompressors } from "./compression.js";
import { ZipWriter } from "./writer.js";

describe("web/writer", () => {
  describe("class ZipWriter", () => {
    describe(".fromWritableStream()", () => {
      it("throws an error if the stream fails", async () => {
        const error = new Error("bang");

        const writableStream = new WritableStream({
          write(chunk, controller) {
            controller.error(error);
          },
        });

        const writer = ZipWriter.fromWritableStream(writableStream);

        const write = writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            comment: "comment 1",
          },
          "hello world",
        );

        await assert.rejects(
          Promise.resolve(write),
          (cause) => cause === error,
        );
      });

      it("writes the correct data to the stream", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.fromWritableStream(new WritableStream(sink));

        await writer.addFile(
          {
            path: "1️⃣.txt",
            comment: "comment 1️⃣",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.finalize();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+11+0 = 41 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(
            GeneralPurposeFlags.HasDataDescriptor |
              GeneralPurposeFlags.HasUtf8Strings,
          ), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          utf8length`1️⃣.txt`, // file name length
          shortUint(0), // extra field length
          utf8`1️⃣.txt`, // file name
          "", // extra field

          //## +0041 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0068 DIRECTORY ENTRY 1 (46+11+0+15 = 72 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Utf8Encoding), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(
            GeneralPurposeFlags.HasDataDescriptor |
              GeneralPurposeFlags.HasUtf8Strings,
          ), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          utf8length`1️⃣.txt`, // file name length
          shortUint(0), // extra field length
          utf8length`comment 1️⃣`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          utf8`1️⃣.txt`, // file name
          "", // extra field
          utf8`comment 1️⃣`, // the comment

          //## +0140 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(140 - 68), // size of the central directory
          longUint(68), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(sink, expected);
        assert.strictEqual(sink.close.mock.callCount(), 1);
      });
    });

    describe("constructor", () => {
      it("defaults to using the default compressors for web", async (t) => {
        const compressorMock = t.mock.fn<(input: Uint8Array) => Uint8Array>(
          () => Buffer.from("compressed!"),
        );
        t.mock.method(
          defaultCompressors,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          CompressionMethod.Deflate.toString() as any,
          mockAsyncTransform(compressorMock),
        );

        const writer = new ZipWriter();

        await writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.finalize();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437`hello.txt`, // file name
          "", // extra field

          //## +0039 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`compressed!`,

          //## +0050 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          utf8length32`compressed!`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0066 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`compressed!`, // compressed size
          utf8length32`hello world`, // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`hello.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0121 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(121 - 66), // size of the central directory
          longUint(66), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(await buffer(writer), expected);

        assert.strictEqual(compressorMock.mock.callCount(), 1);

        assertBufferEqual(
          compressorMock.mock.calls[0]?.arguments[0]!,
          Buffer.from("hello world"),
        );
      });

      it("uses the provided compressors if provided", async (t) => {
        const compressorMock = t.mock.fn<(input: Uint8Array) => Uint8Array>(
          () => Buffer.from("COMPRESSED!"),
        );

        const writer = new ZipWriter({
          compressors: {
            [CompressionMethod.Deflate]: mockAsyncTransform(compressorMock),
          },
        });

        await writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.finalize();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437`hello.txt`, // file name
          "", // extra field

          //## +0039 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`COMPRESSED!`,

          //## +0050 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          utf8length32`COMPRESSED!`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0066 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`COMPRESSED!`, // compressed size
          utf8length32`hello world`, // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`hello.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0121 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(121 - 66), // size of the central directory
          longUint(66), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(await buffer(writer), expected);

        assert.strictEqual(compressorMock.mock.callCount(), 1);

        assertBufferEqual(
          compressorMock.mock.calls[0]?.arguments[0]!,
          Buffer.from("hello world"),
        );
      });
    });

    describe("#[Symbol.asyncDispose]()", () => {
      it("calls close on the sink", async () => {
        const sink = new MockSink();
        const writer = new ZipWriter({ sink });

        assert.strictEqual(sink.close.mock.callCount(), 0);
        await writer[Symbol.asyncDispose]();
        assert.strictEqual(sink.close.mock.callCount(), 1);
      });
    });

    describe("explicit resource management behavior", () => {
      it("calls close on the sink", async () => {
        const sink = new MockSink();

        {
          await using writer = new ZipWriter({ sink });

          void writer;
          assert.strictEqual(sink.close.mock.callCount(), 0);
        }

        assert.strictEqual(sink.close.mock.callCount(), 1);
      });
    });

    describe("#[Symbol.asyncIterable]()", () => {
      it("throws if the writer is in sink mode", async () => {
        const sink = new MockSink();
        const writer = new ZipWriter({ sink });

        await writer.addFile({ path: "folder/" });

        assert.rejects(
          () => buffer(writer),
          (cause) =>
            cause instanceof Error &&
            cause.message ===
              `reading is not supported when initialized with sink`,
        );
      });
    });

    describe("#addFile()", () => {
      it("outputs the correct data", async () => {
        const sink = new MockSink();
        const writer = new ZipWriter({ sink });

        await writer.addFile(
          {
            comment: "comment 2",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date(`1994-03-02T22:44:08Z`),
            path: "uncompressed.txt",
          },
          "this will be stored as-is",
        );

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+16+0 = 46 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`uncompressed.txt`, // file name length
          shortUint(0), // extra field length
          cp437`uncompressed.txt`, // file name
          "", // extra field

          //## +0046 LOCAL ENTRY 1 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //## +0071 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`this will be stored as-is`, // crc
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
        );

        assertBufferEqual(sink, expected);
      });

      it("skips the data descriptor when sizes and crc32 are given", async () => {
        const sink = new MockSink();
        const writer = new ZipWriter({ sink });

        const content = Buffer.from("hello world");
        const crc32 = computeCrc32(content);

        await writer.addFile(
          {
            path: "one.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            crc32,
            compressedSize: content.byteLength,
            uncompressedSize: content.byteLength,
            compressionMethod: CompressionMethod.Stored,
          },
          content,
        );

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+7+0 = 37 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(crc32), // crc32
          longUint(11), // compressed size
          longUint(11), // uncompressed size
          cp437length`one.txt`, // file name length
          shortUint(0), // extra field length
          cp437`one.txt`, // file name
          "", // extra field

          //## +0037 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,
        );

        assertBufferEqual(sink, expected);
      });

      it("throws if finalize() has already been called", async () => {
        const writer = new ZipWriter();

        await writer.finalize();

        await assert.rejects(
          async () => {
            await writer.addFile({ path: "dir/" });
          },
          (error) =>
            error instanceof Error &&
            error.message === `can't add more files after calling finalize()`,
        );
      });
    });

    describe("#finalize()", () => {
      it("throws if it has already been called", async () => {
        const writer = new ZipWriter();

        await writer.finalize();

        await assert.rejects(
          async () => {
            await writer.finalize();
          },
          (error) =>
            error instanceof Error &&
            error.message === `multiple calls to finalize()`,
        );
      });

      it("writes the trailer", async () => {
        const writer = new ZipWriter();

        await writer.addFile(
          {
            comment: "comment 2",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date(`1994-03-02T22:44:08Z`),
            path: "uncompressed.txt",
          },
          "this will be stored as-is",
        );

        await writer.finalize("Gordon is cool");

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+16+0 = 46 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`uncompressed.txt`, // file name length
          shortUint(0), // extra field length
          cp437`uncompressed.txt`, // file name
          "", // extra field

          //## +0046 LOCAL ENTRY 1 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //## +0071 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`this will be stored as-is`, // crc
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size

          //## +0087 DIRECTORY ENTRY 1 (46+16+0+9 = 71 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`uncompressed.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 2`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`uncompressed.txt`, // file name
          "", // extra field
          cp437`comment 2`, // the comment

          //## +0158 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(158 - 87), // size of the central directory
          longUint(87), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        assertBufferEqual(await buffer(writer), expected);
      });
    });

    describe("data generation", () => {
      it("uses the current date time if lastModified is not provided", async (t) => {
        t.mock.timers.enable({ apis: ["Date"] });
        t.mock.timers.setTime(new Date("2005-03-09T12:55:15Z").getTime());

        const writer = new ZipWriter();

        await writer.addFile(
          {
            path: "hello.txt",
            compressionMethod: CompressionMethod.Stored,
          },
          "hello world",
        );

        await writer.finalize();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437`hello.txt`, // file name
          "", // extra field

          //## +0039 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0050 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0066 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`hello.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0121 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(121 - 66), // size of the central directory
          longUint(66), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(await buffer(writer), expected);
      });

      it("can write a utf8 entry", async () => {
        const writer = new ZipWriter();

        await writer.addFile(
          {
            path: "1️⃣.txt",
            comment: "comment 1️⃣",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.finalize();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+11+0 = 41 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(
            GeneralPurposeFlags.HasDataDescriptor |
              GeneralPurposeFlags.HasUtf8Strings,
          ), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          utf8length`1️⃣.txt`, // file name length
          shortUint(0), // extra field length
          utf8`1️⃣.txt`, // file name
          "", // extra field

          //## +0041 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0068 DIRECTORY ENTRY 1 (46+11+0+15 = 72 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Utf8Encoding), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(
            GeneralPurposeFlags.HasDataDescriptor |
              GeneralPurposeFlags.HasUtf8Strings,
          ), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          utf8length`1️⃣.txt`, // file name length
          shortUint(0), // extra field length
          utf8length`comment 1️⃣`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          utf8`1️⃣.txt`, // file name
          "", // extra field
          utf8`comment 1️⃣`, // the comment

          //## +0140 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(140 - 68), // size of the central directory
          longUint(68), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(await buffer(writer), expected);
      });

      it("can write a Zip64", async () => {
        const writer = new ZipWriter();

        await writer.addFile(
          {
            path: "hello.txt",
            zip64: true,
            lastModified: new Date("2005-03-09T12:55:15Z"),
            compressionMethod: CompressionMethod.Stored,
          },
          "hello world",
        );

        await writer.finalize("file comment");

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+9 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          longUint(0), // crc32
          longUint(0xffff_ffff), // compressed size
          longUint(0xffff_ffff), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(20), // extra field length
          cp437`hello.txt`, // file name

          //## +0039 LOCAL ENTRY 1 EXTRA FIELDS (20 bytes)
          shortUint(1), // Zip64 Extended Information Extra Field tag
          shortUint(16), // size
          bigUint(0), // uncompressed size
          bigUint(0), // compressed size

          //## +0059 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0072 LOCAL ENTRY 1 DATA DESCRIPTOR (24 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          bigUint(11), // compressed size
          bigUint(11), // uncompressed size

          //## +0094 DIRECTORY ENTRY 1 (46+9 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          longUint(0xffff_ffff), // compressed size
          longUint(0xffff_ffff), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(28), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0xffff_ffff), // relative offset of local header
          cp437`hello.txt`, // file name

          //## +0149 DIRECTORY ENTRY 1 EXTRA FIELDS (28 bytes)
          shortUint(1), // Zip64 Extended Information Extra Field tag
          shortUint(24), // size
          bigUint(11), // uncompressed size
          bigUint(11), // compressed size
          bigUint(0), // local header offset

          //## +0177 DIRECTORY ENTRY 1 COMMENT (0 bytes)
          "", // the comment

          //## +0177 EOCDR64 (56 bytes)
          longUint(0x06064b50), // EOCDR64 signature (0x06064b50)
          bigUint(56 - 12), // record size (SizeOfFixedFields + SizeOfVariableData - 12)
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Zip64), // version needed
          longUint(0), // number of this disk
          longUint(0), // central directory start disk
          bigUint(1), // total entries this disk
          bigUint(1), // total entries on all disks
          bigUint(177 - 94), // size of the central directory
          bigUint(94), // central directory offset

          //## +0232 EOCDL (20 bytes)
          longUint(0x07064b50), // EOCDL signature
          longUint(0), // start disk of Zip64 EOCDR
          bigUint(177), // offset of Zip64 EOCDR
          longUint(1), // total number of disks

          //## +0254 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0xffff), // number of this disk
          shortUint(0xffff), // central directory start disk
          shortUint(0xffff), // total entries this disk
          shortUint(0xffff), // total entries all disks
          longUint(0xffff_ffff), // size of the central directory
          longUint(0xffff_ffff), // central directory offset
          cp437length`file comment`, // .ZIP file comment length

          cp437`file comment`,
        );

        assertBufferEqual(await buffer(writer), expected);
      });

      it("defaults to CompressionMethod.Stored when content is empty", async () => {
        const writer = new ZipWriter();

        await writer.addFile(
          {
            path: "one.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
          },
          "",
        );

        await writer.addFile({
          path: "two.txt",
          lastModified: new Date(`1994-03-02T22:44:08Z`),
        });

        await writer.finalize();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+7+0 = 37 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`one.txt`, // file name length
          shortUint(0), // extra field length
          cp437`one.txt`, // file name
          "", // extra field

          //## +0037 LOCAL ENTRY 1 CONTENT (0 bytes)

          //## +0037 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size

          //## +0053 LOCAL ENTRY 2 HEADER (30+7+0 = 37 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`two.txt`, // file name length
          shortUint(0), // extra field length
          cp437`two.txt`, // file name
          "", // extra field

          //## +0090 LOCAL ENTRY 2 CONTENT (0 bytes)

          //## +0090 LOCAL ENTRY 2 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size

          //## +0106 DIRECTORY ENTRY 1 (46+7+0+0 = 53 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`one.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(0), // external file attributes
          longUint(0), // relative offset of local header
          cp437`one.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0159 DIRECTORY ENTRY 2 (46+7+0+0 = 53 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`two.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(0), // external file attributes
          longUint(53), // relative offset of local header
          cp437`two.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0212 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(2), // total entries this disk
          shortUint(2), // total entries all disks
          longUint(212 - 106), // size of the central directory
          longUint(106), // central directory offset
          shortUint(0), // .ZIP file comment length
          "", // .ZIP file comment
        );

        assertBufferEqual(await buffer(writer), expected);
      });
    });
  });
});

class MockSink implements ByteSink, Iterable<Uint8Array> {
  public readonly chunks: Uint8Array[] = [];

  public readonly close = mock.fn<ByteSink["close"]>(() => Promise.resolve());

  public readonly write = mock.fn<ByteSink["write"]>((chunk) => {
    this.chunks.push(chunk);
    return Promise.resolve();
  });

  public *[Symbol.iterator](): Iterator<Uint8Array> {
    yield* this.chunks;
  }
}
