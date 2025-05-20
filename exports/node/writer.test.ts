import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { PassThrough } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, it } from "node:test";
import { assertBufferEqual } from "../../test-util/assert.ts";
import {
  crc32,
  data,
  dosDate,
  longUint,
  shortUint,
  tinyUint,
  utf8,
  utf8length,
  utf8length32,
} from "../../test-util/data.ts";
import {
  CompressionMethod,
  ZipPlatform,
  ZipVersion,
} from "../raw/constants.ts";
import { DosFileAttributes } from "../raw/file-attributes.ts";
import { GeneralPurposeFlags } from "../raw/flags.ts";
import { ZipWriter } from "./writer.ts";

describe("module exports/node/writer", () => {
  describe("class ZipWriter", () => {
    describe("static open()", () => {
      it("returns an instance which writes output to the given path", async () => {
        const path = join(tmpdir(), randomUUID());
        const writer = ZipWriter.open(path);

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

        const outputData = await readFile(path);

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

        assertBufferEqual(outputData, expected);
      });
    });

    describe("constructor()", () => {
      it("accepts a Node.js Writable stream", async () => {
        const destination = new PassThrough();
        const writer = new ZipWriter({ destination });
        const outputData = buffer(destination);

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

        assertBufferEqual(await outputData, expected);
      });
    });
  });
});
