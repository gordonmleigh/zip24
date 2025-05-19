import assert from "node:assert";
import { describe, it, mock, type Mock } from "node:test";
import { setTimeout } from "node:timers/promises";
import { assertBufferEqual } from "../test-util/assert.ts";
import {
  bigUint,
  cp437,
  cp437length,
  crc32,
  data,
  dosDate,
  longUint,
  shortUint,
  tinyUint,
  utf8,
  utf8length,
  utf8length32,
} from "../test-util/data.ts";
import { computeCrc32 } from "../util/crc32.ts";
import { normalizeDataSource } from "../util/streams.ts";
import { ZipEntry } from "./entry.ts";
import { CompressionMethod, ZipPlatform, ZipVersion } from "./raw/constants.ts";
import { DosFileAttributes } from "./raw/file-attributes.ts";
import { GeneralPurposeFlags } from "./raw/flags.ts";
import { ZipWriter } from "./writer.ts";

describe("exports/writer", { signal: AbortSignal.timeout(1000) }, () => {
  describe("class ZipWriter", () => {
    describe("static wrap()", () => {
      it("throws an error if the stream fails", async () => {
        const error = new Error("bang");

        const writableStream = new WritableStream({
          write(chunk, controller) {
            controller.error(error);
          },
        });

        const writer = ZipWriter.wrap(writableStream);

        // error might only surface on close
        const result = writer
          .addFile(
            {
              path: "hello.txt",
              lastModified: new Date(`2023-04-05T11:22:34Z`),
              comment: "comment 1",
            },
            "hello world",
          )
          .then(() => writer.close());

        await assert.rejects(result, (cause) => cause === error);
      });

      it("writes the correct data to the stream", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          {
            path: "1️⃣.txt",
            comment: "comment 1️⃣",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.close();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+11+0 = 41 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(GeneralPurposeFlags.HasUtf8Strings), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          utf8length`1️⃣.txt`, // file name length
          shortUint(0), // extra field length
          utf8`1️⃣.txt`, // file name
          "", // extra field

          //## +0041 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0052 DIRECTORY ENTRY 1 (46+11+0+15 = 72 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Utf8Encoding), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(GeneralPurposeFlags.HasUtf8Strings), // flags
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

          //## +0124 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(124 - 52), // size of the central directory
          longUint(52), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(sink, expected);
        assert.strictEqual(sink.closed, true);
      });
    });

    describe("[Symbol.asyncDispose]()", () => {
      it("calls close on the sink", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer[Symbol.asyncDispose]();
        assert.strictEqual(sink.closed, true);
      });
    });

    describe("explicit resource management behavior", () => {
      it("calls close on the sink", async () => {
        const sink = new MockSink();
        let close: Mock<() => Promise<void>> | undefined;

        {
          await using writer = ZipWriter.wrap(sink);
          close = mock.method(writer, "close");
        }

        assert.strictEqual(close.mock.callCount(), 1);
        assert.strictEqual(sink.closed, true);
      });
    });

    describe("get readable", () => {
      it("throws if the writer is in sink mode", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile({ path: "folder/" });

        assert.throws(
          () => {
            void writer.readable;
          },
          (cause) =>
            cause instanceof Error &&
            cause.message ===
              `the stream is not readable when a destination has been supplied`,
        );
      });

      it("buffers data internally for piping to a writer", async () => {
        const sink = new MockSink();
        const zipWriter = new ZipWriter({ comment: "Gordon is cool" });
        const pipeDone = zipWriter.readable.pipeTo(sink);
        const writer = zipWriter.writable.getWriter();

        await writer.write(
          new ZipEntry(
            {
              comment: "comment 1",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-001.txt",
            },
            "this will be stored as-is",
          ),
        );

        await writer.write(
          new ZipEntry(
            {
              comment: "comment 2",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-002.txt",
            },
            "this will be stored as-is",
          ),
        );

        await writer.close();
        await pipeDone;

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+16+0 = 46 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-001.txt`, // file name length
          shortUint(0), // extra field length
          cp437`zip-file-001.txt`, // file name
          "", // extra field

          //## +0046 LOCAL ENTRY 1 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //## +0071 LOCAL ENTRY 2 HEADER (30+16+0 = 46 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-002.txt`, // file name length
          shortUint(0), // extra field length
          cp437`zip-file-002.txt`, // file name
          "", // extra field

          //## +0117 LOCAL ENTRY 2 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //## +0142 DIRECTORY ENTRY 1 (46+16+0+9 = 71 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-001.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 1`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`zip-file-001.txt`, // file name
          "", // extra field
          cp437`comment 1`, // the comment

          //## +0213 DIRECTORY ENTRY 2 (46+16+0+9 = 71 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-002.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 2`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(71), // relative offset of local header
          cp437`zip-file-002.txt`, // file name
          "", // extra field
          cp437`comment 2`, // the comment

          //## +0284 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(2), // total entries this disk
          shortUint(2), // total entries all disks
          longUint(284 - 142), // size of the central directory
          longUint(142), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        assertBufferEqual(sink, expected);
      });

      it("avoids blocking if data is within bufferSize", async () => {
        const sink = new MockSink();
        const zipWriter = new ZipWriter({
          bufferSize: 100, // big enough for only 1 entry
          comment: "Gordon is cool",
        });
        const writer = zipWriter.writable.getWriter();

        const promise1 = writer.write(
          new ZipEntry(
            {
              comment: "comment 1",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-001.txt",
            },
            "this will be stored as-is",
          ),
        );

        const then1 = mock.fn(() => {});
        void promise1.then(then1);
        await setTimeout(10);
        // assert that we didn't block here (then() was called)
        assert.strictEqual(then1.mock.callCount(), 1);

        const promise2 = writer.write(
          new ZipEntry(
            {
              comment: "comment 2",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-002.txt",
            },
            "this will be stored as-is",
          ),
        );

        const then2 = mock.fn(() => {});
        void promise2.then(then2);
        await setTimeout(10);
        // assert that we did block here (then() was not called)
        assert.strictEqual(then2.mock.callCount(), 0);

        const pipeDone = zipWriter.readable.pipeTo(sink);
        await writer.close();
        await pipeDone;

        // assert that we were released eventually
        assert.strictEqual(then2.mock.callCount(), 1);
      });
    });

    describe("get writable", () => {
      it("writes entries to the wrapped sink", async () => {
        const sink = new MockSink();
        const zipWriter = ZipWriter.wrap(sink, { comment: "Gordon is cool" });
        const writer = zipWriter.writable.getWriter();

        await writer.write(
          new ZipEntry(
            {
              comment: "comment 1",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-001.txt",
            },
            "this will be stored as-is",
          ),
        );

        await writer.write(
          new ZipEntry(
            {
              comment: "comment 2",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-002.txt",
            },
            "this will be stored as-is",
          ),
        );

        await writer.close();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+16+0 = 46 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-001.txt`, // file name length
          shortUint(0), // extra field length
          cp437`zip-file-001.txt`, // file name
          "", // extra field

          //## +0046 LOCAL ENTRY 1 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //## +0071 LOCAL ENTRY 2 HEADER (30+16+0 = 46 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-002.txt`, // file name length
          shortUint(0), // extra field length
          cp437`zip-file-002.txt`, // file name
          "", // extra field

          //## +0117 LOCAL ENTRY 2 CONTENT (25 bytes)
          utf8`this will be stored as-is`,

          //## +0142 DIRECTORY ENTRY 1 (46+16+0+9 = 71 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-001.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 1`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`zip-file-001.txt`, // file name
          "", // extra field
          cp437`comment 1`, // the comment

          //## +0213 DIRECTORY ENTRY 2 (46+16+0+9 = 71 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          crc32`this will be stored as-is`, // crc32
          utf8length32`this will be stored as-is`, // compressed size
          utf8length32`this will be stored as-is`, // uncompressed size
          cp437length`zip-file-002.txt`, // file name length
          shortUint(0), // extra field length
          cp437length`comment 2`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(71), // relative offset of local header
          cp437`zip-file-002.txt`, // file name
          "", // extra field
          cp437`comment 2`, // the comment

          //## +0284 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(2), // total entries this disk
          shortUint(2), // total entries all disks
          longUint(284 - 142), // size of the central directory
          longUint(142), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        assertBufferEqual(sink, expected);
      });
    });

    describe("addFile()", () => {
      it("writes a data descriptor when the sizes can't be determined", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          {
            comment: "comment 2",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date(`1994-03-02T22:44:08Z`),
            path: "uncompressed.txt",
          },
          // convert it into a ReadableStream so that it we can't see the length
          normalizeDataSource("this will be stored as-is"),
        );

        await writer.close();

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
          shortUint(0), // .ZIP file comment length
          "", // .ZIP file comment
        );

        assertBufferEqual(sink, expected);
      });

      it("outputs the correct data for a compressed entry", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          {
            path: "hello.txt",
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.close();

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

          //## +0039 LOCAL ENTRY 1 CONTENT (13 bytes)
          "cb48cdc9c95728cf2fca490100",

          //## +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          longUint(13), // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0068 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          longUint(13), // compressed size
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

          //## +0123 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(123 - 68), // size of the central directory
          longUint(68), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(sink, expected);
      });

      it("avoids blocking if data is within output highWaterMark", async () => {
        const sink = new MockSink(100);
        const zipWriter = ZipWriter.wrap(sink);
        const writer = zipWriter.writable.getWriter();

        const promise1 = writer.write(
          new ZipEntry(
            {
              comment: "comment 1",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-001.txt",
            },
            "this will be stored as-is",
          ),
        );

        const then1 = mock.fn(() => {});
        void promise1.then(then1);
        await setTimeout(10);
        // assert that we didn't block here (then() was called)
        assert.strictEqual(then1.mock.callCount(), 1);

        const promise2 = writer.write(
          new ZipEntry(
            {
              comment: "comment 2",
              compressionMethod: CompressionMethod.Stored,
              lastModified: new Date(`1994-03-02T22:44:08Z`),
              path: "zip-file-002.txt",
            },
            "this will be stored as-is",
          ),
        );

        const then2 = mock.fn(() => {});
        void promise2.then(then2);
        await setTimeout(10);
        // assert that we did block here (then() was not called)
        assert.strictEqual(then2.mock.callCount(), 0);

        sink.resume();
        await writer.close();

        // assert that we were released eventually
        assert.strictEqual(then2.mock.callCount(), 1);
      });

      it("can write a ZipEntry instance", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          new ZipEntry(
            {
              path: "hello.txt",
              lastModified: new Date("2005-03-09T12:55:15Z"),
            },
            "hello world",
          ),
        );

        await writer.close();

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

          //## +0039 LOCAL ENTRY 1 CONTENT (13 bytes)
          "cb48cdc9c95728cf2fca490100",

          //## +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          crc32`hello world`, // crc
          longUint(13), // compressed size
          utf8length32`hello world`, // uncompressed size

          //## +0068 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          longUint(13), // compressed size
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

          //## +0123 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(123 - 68), // size of the central directory
          longUint(68), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(sink, expected);
      });

      it("skips the data descriptor when sizes and crc32 can be determined", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          {
            path: "one.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
            compressionMethod: CompressionMethod.Stored,
          },
          "hello world",
        );
        await writer.close();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+7+0 = 37 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          crc32`hello world`, // crc32
          longUint(11), // compressed size
          longUint(11), // uncompressed size
          cp437length`one.txt`, // file name length
          shortUint(0), // extra field length
          cp437`one.txt`, // file name
          "", // extra field

          //## +0037 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0048 DIRECTORY ENTRY 1 (46+7+0+0 = 53 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          crc32`hello world`, // crc32
          longUint(11), // compressed size
          longUint(11), // uncompressed size
          cp437length`one.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`one.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0101 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(101 - 48), // size of the central directory
          longUint(48), // central directory offset
          shortUint(0), // .ZIP file comment length
          "", // .ZIP file comment
        );

        assertBufferEqual(sink, expected);
      });

      it("skips the data descriptor when sizes and crc32 are given", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

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
          // convert to readable so we can't see the size
          normalizeDataSource(content),
        );
        await writer.close();

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

          //## +0048 DIRECTORY ENTRY 1 (46+7+0+0 = 53 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(crc32), // crc32
          longUint(11), // compressed size
          longUint(11), // uncompressed size
          cp437length`one.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(DosFileAttributes.File), // external file attributes
          longUint(0), // relative offset of local header
          cp437`one.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0101 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(101 - 48), // size of the central directory
          longUint(48), // central directory offset
          shortUint(0), // .ZIP file comment length
          "", // .ZIP file comment
        );

        assertBufferEqual(sink, expected);
      });

      it("throws if close() has already been called", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.close();

        await assert.rejects(
          async () => {
            await writer.addFile({ path: "dir/" });
          },
          (error) =>
            error instanceof TypeError &&
            "code" in error &&
            error.code === "ERR_INVALID_STATE",
        );
      });

      it("can be called concurrently", async () => {
        const sink = new MockSink();
        const writer = new ZipWriter({ bufferSize: 1 });
        const pipeDone = writer.readable.pipeTo(sink);

        // need three entries to make sure there's waiting
        await Promise.all([
          writer.addFile({
            path: "one.txt",
            lastModified: new Date(`2023-04-05T11:22:34Z`),
          }),
          writer.addFile({
            path: "two.txt",
            lastModified: new Date(`1994-03-02T22:44:08Z`),
          }),
          writer.addFile({
            path: "thr.txt",
            lastModified: new Date(`1994-03-02T22:44:08Z`),
          }),
        ]).then(() => writer.close());

        await pipeDone;

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

          //## +0106 LOCAL ENTRY 3 HEADER (30+7+0 = 37 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`1994-03-02T22:44:08Z`, // last modified
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size
          cp437length`thr.txt`, // file name length
          shortUint(0), // extra field length
          cp437`thr.txt`, // file name
          "", // extra field

          //## +0143 LOCAL ENTRY 3 CONTENT (0 bytes)

          //## +0143 LOCAL ENTRY 3 DATA DESCRIPTOR (16 bytes)
          longUint(0x08074b50), // data descriptor signature
          longUint(0), // crc32
          longUint(0), // compressed size
          longUint(0), // uncompressed size

          //## +0159 DIRECTORY ENTRY 1 (46+7+0+0 = 53 bytes)
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

          //## +0212 DIRECTORY ENTRY 2 (46+7+0+0 = 53 bytes)
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

          //## +0265 DIRECTORY ENTRY 3 (46+7+0+0 = 53 bytes)
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
          cp437length`thr.txt`, // file name length
          shortUint(0), // extra field length
          shortUint(0), // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint(0), // external file attributes
          longUint(106), // relative offset of local header
          cp437`thr.txt`, // file name
          "", // extra field
          "", // the comment

          //## +0318 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(3), // total entries this disk
          shortUint(3), // total entries all disks
          longUint(318 - 159), // size of the central directory
          longUint(159), // central directory offset
          shortUint(0), // .ZIP file comment length
          "", // .ZIP file comment
        );

        assertBufferEqual(sink, expected);
      });
    });

    describe("close()", () => {
      it("throws if it has already been called", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.close();

        await assert.rejects(
          async () => {
            await writer.close();
          },
          (error) =>
            error instanceof TypeError &&
            "code" in error &&
            error.code === "ERR_INVALID_STATE",
        );
      });

      it("writes the trailer including the comment", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink, { comment: "Gordon is cool" });

        await writer.addFile(
          {
            comment: "comment 2",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date(`1994-03-02T22:44:08Z`),
            path: "uncompressed.txt",
          },
          normalizeDataSource("this will be stored as-is"),
        );

        await writer.close();

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

        assertBufferEqual(sink, expected);
      });

      it("calls close on the sink", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);
        await writer.close();

        assert.strictEqual(sink.closed, true);
      });

      it("does not call close on the sink if preventClose is true", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink, { preventClose: true });
        await writer.close();

        assert.strictEqual(sink.closed, false);
        assert.strictEqual(sink.locked, false);
      });
    });

    describe("stream error propagation", () => {
      it("aborting the writable also aborts the sink", async () => {
        const error = new Error("bang!");
        const sink = new MockSink();
        const zipWriter = ZipWriter.wrap(sink);

        const writer = zipWriter.writable.getWriter();
        await writer.abort(error);

        assert.strictEqual(sink.error, error);
      });

      it("aborting the writable does not abort the sink if preventAbort is true", async () => {
        const error = new Error("bang!");
        const sink = new MockSink();
        const zipWriter = ZipWriter.wrap(sink, { preventAbort: true });

        const writer = zipWriter.writable.getWriter();
        await writer.abort(error);

        assert.strictEqual(sink.error, undefined);
        assert.strictEqual(sink.locked, false);
      });
    });

    describe("data generation", () => {
      it("uses the current date time if lastModified is not provided", async (t) => {
        t.mock.timers.enable({ apis: ["Date"] });
        t.mock.timers.setTime(new Date("2005-03-09T12:55:15Z").getTime());

        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          {
            path: "hello.txt",
            compressionMethod: CompressionMethod.Stored,
          },
          "hello world",
        );

        await writer.close();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          cp437length`hello.txt`, // file name length
          shortUint(0), // extra field length
          cp437`hello.txt`, // file name
          "", // extra field

          //## +0039 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0050 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Deflate), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Deflate), // version needed
          shortUint(0), // flags
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

          //## +0105 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(105 - 50), // size of the central directory
          longUint(50), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(sink, expected);
      });

      it("can write a utf8 entry", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

        await writer.addFile(
          {
            path: "1️⃣.txt",
            comment: "comment 1️⃣",
            compressionMethod: CompressionMethod.Stored,
            lastModified: new Date("2005-03-09T12:55:15Z"),
          },
          "hello world",
        );

        await writer.close();

        const expected = data(
          //## +0000 LOCAL ENTRY 1 HEADER (30+11+0 = 41 bytes)
          longUint(0x04034b50), // local header signature
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(GeneralPurposeFlags.HasUtf8Strings), // flags
          shortUint(CompressionMethod.Stored), // compression method
          dosDate`2005-03-09T12:55:15Z`, // last modified
          crc32`hello world`, // crc32
          utf8length32`hello world`, // compressed size
          utf8length32`hello world`, // uncompressed size
          utf8length`1️⃣.txt`, // file name length
          shortUint(0), // extra field length
          utf8`1️⃣.txt`, // file name
          "", // extra field

          //## +0041 LOCAL ENTRY 1 CONTENT (11 bytes)
          utf8`hello world`,

          //## +0052 DIRECTORY ENTRY 1 (46+11+0+15 = 72 bytes)
          longUint(0x02014b50), // central directory header signature
          tinyUint(ZipVersion.Utf8Encoding), // version made by
          tinyUint(ZipPlatform.DOS), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed
          shortUint(GeneralPurposeFlags.HasUtf8Strings), // flags
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

          //## +0124 End of Central Directory Record
          longUint(0x06054b50), // EOCDR signature
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(1), // total entries this disk
          shortUint(1), // total entries all disks
          longUint(124 - 52), // size of the central directory
          longUint(52), // central directory offset
          shortUint(0), // .ZIP file comment length
        );

        assertBufferEqual(sink, expected);
      });

      it("can write a Zip64", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink, { comment: "file comment" });

        await writer.addFile(
          {
            path: "hello.txt",
            zip64: true,
            lastModified: new Date("2005-03-09T12:55:15Z"),
            compressionMethod: CompressionMethod.Stored,
          },
          normalizeDataSource("hello world"),
        );

        await writer.close();

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

        assertBufferEqual(sink, expected);
      });

      it("defaults to CompressionMethod.Stored when content is empty", async () => {
        const sink = new MockSink();
        const writer = ZipWriter.wrap(sink);

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

        await writer.close();

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

        assertBufferEqual(sink, expected);
      });
    });
  });
});

class MockSink
  extends WritableStream<Uint8Array>
  implements Iterable<Uint8Array>
{
  readonly #queue: (() => void)[] = [];
  #paused: boolean;

  public readonly chunks: Uint8Array[] = [];
  public closed = false;
  public error: unknown;
  public size = 0;

  public constructor(highWaterMark?: number) {
    super(
      {
        abort: (reason) => {
          this.error = reason;
        },

        close: () => {
          this.closed = true;
        },

        write: async (chunk) => {
          this.size += chunk.length;
          this.chunks.push(chunk);

          if (this.#paused) {
            await new Promise<void>((resolve) => {
              this.#queue.push(resolve);
            });
          }
        },
      },
      highWaterMark === undefined
        ? undefined
        : new ByteLengthQueuingStrategy({ highWaterMark }),
    );
    this.#paused = highWaterMark !== undefined;
  }

  public processChunk(): boolean {
    this.#queue.pop()?.();
    return this.#queue.length > 0;
  }

  public resume(): void {
    this.#paused = false;
    while (this.#queue.length > 0) {
      this.processChunk();
    }
  }

  public *[Symbol.iterator](): Iterator<Uint8Array> {
    yield* this.chunks;
  }
}
