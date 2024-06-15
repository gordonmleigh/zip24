import assert from "node:assert";
import { describe, it } from "node:test";
import { CompressionMethod, ZipPlatform, ZipVersion } from "../common.js";
import { ZipDirectoryReader } from "./directory-reader.js";
import { cp437, data, utf8 } from "./test-utils/data.js";

describe("ZipDirectoryReader", () => {
  describe("read()", () => {
    it("can read a header", () => {
      const buffer = data(
        /* 00 +04 */ "504b0102", // signature  (0x02014b50)
        /* 04 +02 */ "1503", // version made by (21 = 2.1), platform (3 = Unix)
        /* 06 +02 */ "1500", // version needed (21 = 2.1)
        /* 08 +02 */ "4100", // flags
        /* 10 +02 */ "0800", // compression method (8 = DEFLATE)
        /* 12 +02 */ "6a51", // last mod file time (10:11:20)
        /* 14 +02 */ "a656", // last mod file date, (2023-05-06)
        /* 16 +04 */ "12345678", // crc-32
        /* 20 +04 */ "87654321", // compressed size
        /* 24 +04 */ "12348765", // uncompressed size
        /* 28 +02 */ "0800", // file name length
        /* 30 +02 */ "0000", // extra field length
        /* 32 +02 */ "0600", // file comment length
        /* 34 +02 */ "0000", // disk number start
        /* 36 +02 */ "0000", // internal file attributes
        /* 38 +04 */ "0000a481", // external file attributes
        /* 42 +04 */ "abcdef12", // relative offset of local header
        /* 46 +08 */ cp437`ôöò/path`, // file name
        /* 54 +00 */ "", // extra field
        /* 54 +11 */ "010203040506", // the comment
      );

      const reader = new ZipDirectoryReader();
      assert.strictEqual(reader.fixedFieldsLength, 46);

      reader.read(buffer);

      assert.strictEqual(reader.versionMadeBy, ZipVersion.Deflate64);
      assert.strictEqual(reader.platformMadeBy, ZipPlatform.UNIX);
      assert.strictEqual(reader.versionNeeded, ZipVersion.Deflate64);
      assert(reader.flags.hasEncryption);
      assert(reader.flags.hasStrongEncryption);
      assert(!reader.flags.hasUtf8Strings);
      assert(!reader.flags.hasDataDescriptor);

      assert.strictEqual(reader.compressionMethod, CompressionMethod.Deflate);

      assert.strictEqual(
        reader.lastModified.toISOString(),
        new Date(2023, 5 - 1, 6, 10, 11, 20).toISOString(),
      );

      assert.strictEqual(reader.crc32, 0x78563412);
      assert.strictEqual(reader.compressedSize, 0x21436587);
      assert.strictEqual(reader.uncompressedSize, 0x65873412);

      assert.strictEqual(reader.fileNameLength, 8);
      assert.strictEqual(reader.extraFieldLength, 0);
      assert.strictEqual(reader.fileCommentLength, 6);

      assert.strictEqual(reader.localHeaderOffset, 0x12efcdab);
      assert.strictEqual(reader.externalFileAttributes, 0x81a40000);

      assert.strictEqual(reader.fileNameOffset, 46);
      assert.strictEqual(reader.extraFieldOffset, 46 + 8);
      assert.strictEqual(reader.fileCommentOffset, 46 + 8 + 0);
      assert.strictEqual(reader.variableDataLength, 8 + 0 + 6);
      assert.strictEqual(reader.totalRecordLength, 46 + 8 + 0 + 6);

      assert.strictEqual(reader.fileName, "ôöò/path");
      assert.strictEqual(reader.fileComment, "☺☻♥♦♣♠");
    });

    it("throws when disk number start is non-zero", () => {
      const buffer = data(
        /* 00 +04 */ "504b0102", // signature  (0x02014b50)
        /* 04 +02 */ "1503", // version made by (21 = 2.1), platform (3 = Unix)
        /* 06 +02 */ "1500", // version needed (21 = 2.1)
        /* 08 +02 */ "4100", // flags
        /* 10 +02 */ "0800", // compression method (8 = DEFLATE)
        /* 12 +02 */ "6a51", // last mod file time (10:11:20)
        /* 14 +02 */ "a656", // last mod file date, (2023-05-06)
        /* 16 +04 */ "12345678", // crc-32
        /* 20 +04 */ "87654321", // compressed size
        /* 24 +04 */ "12348765", // uncompressed size
        /* 28 +02 */ "0800", // file name length
        /* 30 +02 */ "0000", // extra field length
        /* 32 +02 */ "0600", // file comment length
        /* 34 +02 */ "0100", // disk number start
        /* 36 +02 */ "0000", // internal file attributes
        /* 38 +04 */ "0000a481", // external file attributes
        /* 42 +04 */ "00000000", // relative offset of local header
        /* 46 +08 */ cp437`ôöò/path`, // file name
        /* 54 +00 */ "", // extra field
        /* 54 +11 */ "010203040506", // the comment
      );

      const reader = new ZipDirectoryReader();
      assert.throws(() => reader.read(buffer));
    });

    it("decodes file name and comment as cp437", () => {
      const buffer = data(
        /* 00 +04 */ "504b0102", // signature  (0x02014b50)
        /* 04 +02 */ "1503", // version made by (21 = 2.1), platform (3 = Unix)
        /* 06 +02 */ "1500", // version needed (21 = 2.1)
        /* 08 +02 */ "4100", // flags
        /* 10 +02 */ "0800", // compression method (8 = DEFLATE)
        /* 12 +02 */ "6a51", // last mod file time (10:11:20)
        /* 14 +02 */ "a656", // last mod file date, (2023-05-06)
        /* 16 +04 */ "12345678", // crc-32
        /* 20 +04 */ "87654321", // compressed size
        /* 24 +04 */ "12348765", // uncompressed size
        /* 28 +02 */ "0400", // file name length
        /* 30 +02 */ "0000", // extra field length
        /* 32 +02 */ "0400", // file comment length
        /* 34 +02 */ "0000", // disk number start
        /* 36 +02 */ "0000", // internal file attributes
        /* 38 +04 */ "0000a481", // external file attributes
        /* 42 +04 */ "00000000", // relative offset of local header
        /* 46 +08 */ "f09fa5ba", // file name
        /* 54 +00 */ "", // extra field
        /* 54 +11 */ "f09f9883", // the comment
      );

      const reader = new ZipDirectoryReader();
      reader.read(buffer);

      assert.strictEqual(reader.fileName, "≡ƒÑ║");
      assert.strictEqual(reader.fileComment, "≡ƒÿâ");
    });

    it("decodes file name and comment as utf-8 if the unicode flag is set", () => {
      const buffer = data(
        /* 00 +04 */ "504b0102", // signature  (0x02014b50)
        /* 04 +02 */ "1503", // version made by (21 = 2.1), platform (3 = Unix)
        /* 06 +02 */ "1500", // version needed (21 = 2.1)
        /* 08 +02 */ "0008", // flags
        /* 10 +02 */ "0800", // compression method (8 = DEFLATE)
        /* 12 +02 */ "6a51", // last mod file time (10:11:20)
        /* 14 +02 */ "a656", // last mod file date, (2023-05-06)
        /* 16 +04 */ "12345678", // crc-32
        /* 20 +04 */ "87654321", // compressed size
        /* 24 +04 */ "12348765", // uncompressed size
        /* 28 +02 */ "0400", // file name length
        /* 30 +02 */ "0000", // extra field length
        /* 32 +02 */ "0400", // file comment length
        /* 34 +02 */ "0000", // disk number start
        /* 36 +02 */ "0000", // internal file attributes
        /* 38 +04 */ "0000a481", // external file attributes
        /* 42 +04 */ "00000000", // relative offset of local header
        /* 46 +08 */ "f09fa5ba", // file name
        /* 54 +00 */ "", // extra field
        /* 54 +11 */ "f09f9883", // the comment
      );

      const reader = new ZipDirectoryReader();
      reader.read(buffer);

      assert.strictEqual(reader.fileName, "🥺");
      assert.strictEqual(reader.fileComment, "😃");
    });

    it("decodes extra fields", () => {
      const buffer = data(
        /* 00 +04 */ "504b0102", // signature  (0x02014b50)
        /* 04 +02 */ "1503", // version made by (21 = 2.1), platform (3 = Unix)
        /* 06 +02 */ "1500", // version needed (21 = 2.1)
        /* 08 +02 */ "0000", // flags
        /* 10 +02 */ "0800", // compression method (8 = DEFLATE)
        /* 12 +02 */ "6a51", // last mod file time (10:11:20)
        /* 14 +02 */ "a656", // last mod file date, (2023-05-06)
        /* 16 +04 */ "12345678", // crc-32
        /* 20 +04 */ "ffffffff", // compressed size
        /* 24 +04 */ "ffffffff", // uncompressed size
        /* 28 +02 */ "0500", // file name length
        /* 30 +02 */ "3500", // extra field length
        /* 32 +02 */ "0500", // file comment length
        /* 34 +02 */ "0000", // disk number start
        /* 36 +02 */ "0000", // internal file attributes
        /* 38 +04 */ "0000a481", // external file attributes
        /* 42 +04 */ "ffffffff", // relative offset of local header
        /* 46 +08 */ cp437`world`, // file name

        "7563", // tag: Info-ZIP Unicode Comment Extra Field
        "0800", // size: 8 bytes
        "01", // version
        "86a61036", // crc of "hello"
        utf8`ABC`, // data

        "7570", // tag: Info-ZIP Unicode Path Extra Field
        "0900", // size: 9 bytes
        "01", // version
        "4311773a", // crc of "world"
        utf8`🥺`, // data

        "0100", // tag: Zip64 extended information extra field
        "1800", // size: 24 bytes
        "0102030405060000", // uncompressed size
        "0605040302010000", // compressed size
        "0302010302010000", // local header offset

        cp437`hello`, // the comment
      );

      const reader = new ZipDirectoryReader();
      reader.read(buffer);

      assert.strictEqual(reader.fileComment, "ABC");
      assert.strictEqual(reader.fileName, "🥺");
      assert.strictEqual(reader.uncompressedSize, 0x060504030201);
      assert.strictEqual(reader.compressedSize, 0x010203040506);
      assert.strictEqual(reader.localHeaderOffset, 0x010203010203);
    });
  });
});
