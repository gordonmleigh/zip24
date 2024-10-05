import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable, type StreamOptions } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
} from "../common.js";
import { assertBufferEqual, assertInstanceOf } from "../test-util/assert.js";
import {
  cp437,
  cp437length,
  crc32,
  data,
  deflate,
  deflateLength32,
  dosDate,
  longUint,
  mockAsyncTransform,
  shortUint,
  tinyUint,
  utf8,
  utf8length32,
} from "../test-util/data.js";
import { getTemporaryOutputDirectory } from "../test-util/fixtures.js";
import { defaultCompressors } from "./compression.js";
import { ZipWriter } from "./writer.js";

describe("node/writer", () => {
  describe("class ZipWriter", () => {
    describe("constructor", () => {
      it("defaults to using the default compressors for node", async (t) => {
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

    describe(".fromWritable()", () => {
      it("throws an error if the stream fails", async () => {
        const error = new Error("bang");

        const writable = new Writable({
          construct(callback) {
            callback(error);
          },
        });

        const writer = ZipWriter.fromWritable(writable);

        const write = writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            comment: "comment 1",
            attributes: new UnixFileAttributes(0o644),
          },
          "hello world",
        );

        await assert.rejects(
          Promise.resolve(write),
          (cause) => cause === error,
        );
      });

      it("writes the correct data to the stream", async () => {
        const chunks: Uint8Array[] = [];

        const destroy = mock.fn<Required<StreamOptions<Writable>>["destroy"]>(
          (error, callback) => {
            callback();
          },
        );

        const writable = new Writable({
          destroy,
          write(chunk, encoding, callback) {
            assertInstanceOf(chunk, Uint8Array);
            chunks.push(chunk);
            callback();
          },
        });

        const writer = ZipWriter.fromWritable(writable);

        await writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            comment: "comment 1",
            attributes: new UnixFileAttributes(0o644),
          },
          "hello world",
        );

        await writer.addFile(
          {
            path: "uncompressed.txt",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date(`1994-03-02T22:44:08Z`),
            comment: "comment 2",
          },
          "this will be stored as-is",
        );

        await writer.finalize("Gordon is cool");

        const expected = data(
          //// +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437`hello.txt`, // file name
          "", // extra field

          //// +0039 LOCAL ENTRY 1 CONTENT (13 bytes)
          deflate`hello world`,

          //// +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          deflateLength32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //// +0068 LOCAL ENTRY 2 HEADER (30+16+0 = 46 bytes)
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

          //// +0114 LOCAL ENTRY 2 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //// +0139 LOCAL ENTRY 2 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`this will be stored as-is`, // crc
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size

          //// +0155 DIRECTORY ENTRY 1 (46+9+0+9 = 64 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          crc32`hello world`, // crc32
          deflateLength32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 1`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(UnixFileAttributes.raw(UnixFileAttributes.File | 0o644)), // external file attributes
          longUint(0), // relative offset of local header
          cp437`hello.txt`, // file name
          "", // extra field
          cp437`comment 1`, // the comment

          //// +0219 DIRECTORY ENTRY 2 (46+16+0+9 = 71 bytes)
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
          longUint(68), // relative offset of local header
          cp437`uncompressed.txt`, // file name
          "", // extra field
          cp437`comment 2`, // the comment

          //// +0290 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(2), // total entries this disk
          shortUint(2), // total entries all disks
          longUint(290 - 155), // size of the central directory
          longUint(155), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        assertBufferEqual(data(...chunks), expected);
        assert.strictEqual(destroy.mock.callCount(), 1);
      });
    });

    describe(".open()", () => {
      it("throws an error if the stream fails", async () => {
        const path = join("./invalid-dir/output.zip");
        const writer = ZipWriter.open(path);

        const write = writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            comment: "comment 1",
            attributes: new UnixFileAttributes(0o644),
          },
          "hello world",
        );

        await assert.rejects(
          Promise.resolve(write),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          (cause: any) => cause?.code === "ENOENT",
        );
      });

      it("writes the correct data to the file", async () => {
        const outputDirectory = await getTemporaryOutputDirectory();
        const path = join(outputDirectory, "test-ZipWriter-open.zip");

        const writer = ZipWriter.open(path);

        await writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            comment: "comment 1",
            attributes: new UnixFileAttributes(0o644),
          },
          "hello world",
        );

        await writer.addFile(
          {
            path: "uncompressed.txt",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date(`1994-03-02T22:44:08Z`),
            comment: "comment 2",
          },
          "this will be stored as-is",
        );

        await writer.finalize("Gordon is cool");

        const expected = data(
          //// +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437`hello.txt`, // file name
          "", // extra field

          //// +0039 LOCAL ENTRY 1 CONTENT (13 bytes)
          deflate`hello world`,

          //// +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          deflateLength32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size

          //// +0068 LOCAL ENTRY 2 HEADER (30+16+0 = 46 bytes)
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

          //// +0114 LOCAL ENTRY 2 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //// +0139 LOCAL ENTRY 2 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`this will be stored as-is`, // crc
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size

          //// +0155 DIRECTORY ENTRY 1 (46+9+0+9 = 64 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          crc32`hello world`, // crc32
          deflateLength32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 1`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(UnixFileAttributes.raw(UnixFileAttributes.File | 0o644)), // external file attributes
          longUint(0), // relative offset of local header
          cp437`hello.txt`, // file name
          "", // extra field
          cp437`comment 1`, // the comment

          //// +0219 DIRECTORY ENTRY 2 (46+16+0+9 = 71 bytes)
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
          longUint(68), // relative offset of local header
          cp437`uncompressed.txt`, // file name
          "", // extra field
          cp437`comment 2`, // the comment

          //// +0290 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(2), // total entries this disk
          shortUint(2), // total entries all disks
          longUint(290 - 155), // size of the central directory
          longUint(155), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        assertBufferEqual(await readFile(path), expected);
      });
    });
  });
});
