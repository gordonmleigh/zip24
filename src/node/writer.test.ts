import { buffer } from "node:stream/consumers";
import { describe, it } from "node:test";
import { GeneralPurposeFlags } from "../common.js";
import { CompressionMethod } from "../core/compression-core.js";
import { ZipPlatform, ZipVersion } from "../core/constants.js";
import {
  DosFileAttributes,
  UnixFileAttributes,
} from "../core/file-attributes.js";
import { assertBufferEqual } from "../testing/assert.js";
import {
  bigUint,
  cp437,
  cp437length,
  crc32,
  data,
  deflate,
  deflateLength32,
  dosDate,
  longUint,
  shortUint,
  tinyUint,
  utf8,
  utf8length,
  utf8length32,
} from "../testing/data.js";
import { ZipWriter } from "./writer.js";

describe("node/writer", () => {
  describe("ZipWriter", () => {
    it("produces the correct data", async () => {
      const writer = new ZipWriter();
      const output = buffer(writer);

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

      assertBufferEqual(await output, expected);
    });

    it("uses the current date time if lastModified is not provided", async (context) => {
      context.mock.timers.enable({ apis: ["Date"] });
      context.mock.timers.setTime(new Date("2005-03-09T12:55:15Z").getTime());

      const writer = new ZipWriter();
      const output = buffer(writer);

      await writer.addFile(
        {
          path: "hello.txt",
          compressionMethod: CompressionMethod.Stored,
        },
        "hello world",
      );

      await writer.finalize();

      const expected = data(
        //// +0000 LOCAL ENTRY 1 HEADER (30+9+0 = 39 bytes)
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

        //// +0039 LOCAL ENTRY 1 CONTENT (11 bytes)
        utf8`hello world`,

        //// +0050 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
        longUint(0x08074b50), // data descriptor signature
        crc32`hello world`, // crc
        utf8length32`hello world`, // compressed size
        utf8length32`hello world`, // uncompressed size

        //// +0066 DIRECTORY ENTRY 1 (46+9+0+0 = 55 bytes)
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

        //// +0121 End of Central Directory Record
        longUint(0x06054b50), // EOCDR signature
        shortUint(0), // number of this disk
        shortUint(0), // central directory start disk
        shortUint(1), // total entries this disk
        shortUint(1), // total entries all disks
        longUint(121 - 66), // size of the central directory
        longUint(66), // central directory offset
        shortUint(0), // .ZIP file comment length
      );

      assertBufferEqual(await output, expected);
    });

    it("can write a utf8 entry", async () => {
      const writer = new ZipWriter();
      const output = buffer(writer);

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
        //// +0000 LOCAL ENTRY 1 HEADER (30+11+0 = 41 bytes)
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

        //// +0041 LOCAL ENTRY 1 CONTENT (11 bytes)
        utf8`hello world`,

        //// +0052 LOCAL ENTRY 1 DATA DESCRIPTOR (16 bytes)
        longUint(0x08074b50), // data descriptor signature
        crc32`hello world`, // crc
        utf8length32`hello world`, // compressed size
        utf8length32`hello world`, // uncompressed size

        //// +0068 DIRECTORY ENTRY 1 (46+11+0+15 = 72 bytes)
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

        //// +0140 End of Central Directory Record
        longUint(0x06054b50), // EOCDR signature
        shortUint(0), // number of this disk
        shortUint(0), // central directory start disk
        shortUint(1), // total entries this disk
        shortUint(1), // total entries all disks
        longUint(140 - 68), // size of the central directory
        longUint(68), // central directory offset
        shortUint(0), // .ZIP file comment length
      );

      assertBufferEqual(await output, expected);
    });

    it("can write a Zip64", async () => {
      const writer = new ZipWriter();
      const output = buffer(writer);

      await writer.addFile(
        {
          path: "hello.txt",
          zip64: true,
          lastModified: new Date("2005-03-09T12:55:15Z"),
        },
        "hello world",
      );

      await writer.finalize("file comment");

      const expected = data(
        //// +0000 LOCAL ENTRY 1 HEADER (30+9 = 39 bytes)
        longUint(0x04034b50), // local header signature
        shortUint(ZipVersion.Zip64), // version needed
        shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
        shortUint(CompressionMethod.Deflate), // compression method
        dosDate`2005-03-09T12:55:15Z`, // last modified
        longUint(0), // crc32
        longUint(0xffff_ffff), // compressed size
        longUint(0xffff_ffff), // uncompressed size
        cp437length`hello.txt`, // file name length
        shortUint(20), // extra field length
        cp437`hello.txt`, // file name

        //// +0039 LOCAL ENTRY 1 EXTRA FIELDS (20 bytes)
        shortUint(1), // Zip64 Extended Information Extra Field tag
        shortUint(16), // size
        bigUint(0), // uncompressed size
        bigUint(0), // compressed size

        //// +0059 LOCAL ENTRY 1 CONTENT (13 bytes)
        deflate`hello world`,

        //// +0072 LOCAL ENTRY 1 DATA DESCRIPTOR (24 bytes)
        longUint(0x08074b50), // data descriptor signature
        crc32`hello world`, // crc
        bigUint(13), // compressed size
        bigUint(11), // uncompressed size

        //// +0096 DIRECTORY ENTRY 1 (46+9 = 55 bytes)
        longUint(0x02014b50), // central directory header signature
        tinyUint(ZipVersion.Zip64), // version made by
        tinyUint(ZipPlatform.DOS), // platform made by
        shortUint(ZipVersion.Zip64), // version needed
        shortUint(GeneralPurposeFlags.HasDataDescriptor), // flags
        shortUint(CompressionMethod.Deflate), // compression method
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

        //// +0151 DIRECTORY ENTRY 1 EXTRA FIELDS (28 bytes)
        shortUint(1), // Zip64 Extended Information Extra Field tag
        shortUint(24), // size
        bigUint(11), // uncompressed size
        bigUint(13), // compressed size
        bigUint(0), // local header offset

        //// +0179 DIRECTORY ENTRY 1 COMMENT (0 bytes)
        "", // the comment

        //// +0179 EOCDR64 (56 bytes)
        longUint(0x06064b50), // EOCDR64 signature (0x06064b50)
        bigUint(56 - 12), // record size (SizeOfFixedFields + SizeOfVariableData - 12)
        tinyUint(ZipVersion.Zip64), // version made by
        tinyUint(ZipPlatform.UNIX), // platform made by
        shortUint(ZipVersion.Zip64), // version needed
        longUint(0), // number of this disk
        longUint(0), // central directory start disk
        bigUint(1), // total entries this disk
        bigUint(1), // total entries on all disks
        bigUint(179 - 96), // size of the central directory
        bigUint(96), // central directory offset

        //// +0234 EOCDL (20 bytes)
        longUint(0x07064b50), // EOCDL signature
        longUint(0), // start disk of Zip64 EOCDR
        bigUint(179), // offset of Zip64 EOCDR
        longUint(1), // total number of disks

        //// +0254 End of Central Directory Record
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

      assertBufferEqual(await output, expected);
    });
  });
});
