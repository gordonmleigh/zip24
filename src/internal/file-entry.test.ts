import assert from "node:assert";
import { describe, it } from "node:test";
import {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
} from "../common.js";
import {
  readDirectoryEntry,
  readExtraFields,
  type ZipEntry,
} from "./file-entry.js";
import { CentralHeaderLength } from "./signatures.js";
import { cp437, data, utf8 } from "./test-utils/data.js";

describe("readDirectoryEntry()", () => {
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

    const entry = new TestZipEntry();
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.versionMadeBy, ZipVersion.Deflate64);
    assert.strictEqual(entry.platformMadeBy, ZipPlatform.UNIX);
    assert.strictEqual(entry.versionNeeded, ZipVersion.Deflate64);
    assert(entry.flags.hasEncryption);
    assert(entry.flags.hasStrongEncryption);
    assert(!entry.flags.hasUtf8Strings);
    assert(!entry.flags.hasDataDescriptor);

    assert.strictEqual(entry.compressionMethod, CompressionMethod.Deflate);

    assert.strictEqual(
      entry.lastModified.toISOString(),
      new Date(2023, 5 - 1, 6, 10, 11, 20).toISOString(),
    );

    assert.strictEqual(entry.crc32, 0x78563412);
    assert.strictEqual(entry.compressedSize, 0x21436587);
    assert.strictEqual(entry.uncompressedSize, 0x65873412);

    assert.strictEqual(entry.fileNameLength, 8);
    assert.strictEqual(entry.extraFieldLength, 0);
    assert.strictEqual(entry.fileCommentLength, 6);

    assert.strictEqual(entry.localHeaderOffset, 0x12efcdab);
    assert.strictEqual(entry.externalFileAttributes?.value, 0x81a4);

    assert.strictEqual(entry.totalRecordLength, 46 + 8 + 0 + 6);

    assert.strictEqual(entry.fileName, "ôöò/path");
    assert.strictEqual(entry.fileComment, "☺☻♥♦♣♠");
  });

  it("sets unixFileAttributes if the platform is unix", () => {
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

    const entry = new TestZipEntry();
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.platformMadeBy, ZipPlatform.UNIX);
    assert.strictEqual(entry.externalFileAttributes?.value, 0x81a4);
  });

  it("sets dosFileAttributes if the platform is DOS", () => {
    const buffer = data(
      /* 00 +04 */ "504b0102", // signature  (0x02014b50)
      /* 04 +02 */ "1500", // version made by (21 = 2.1), platform (0 = DOS)
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
      /* 38 +04 */ "11000000", // external file attributes
      /* 42 +04 */ "abcdef12", // relative offset of local header
      /* 46 +08 */ cp437`ôöò/path`, // file name
      /* 54 +00 */ "", // extra field
      /* 54 +11 */ "010203040506", // the comment
    );

    const entry = new TestZipEntry();
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.platformMadeBy, ZipPlatform.DOS);
    assert.strictEqual(entry.externalFileAttributes?.value, 0x11);
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

    const entry = new TestZipEntry();

    assert.throws(() => {
      readDirectoryEntry(entry, buffer);
    });
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

    const entry = new TestZipEntry();
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.fileName, "≡ƒÑ║");
    assert.strictEqual(entry.fileComment, "≡ƒÿâ");
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

    const entry = new TestZipEntry();
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.fileName, "🥺");
    assert.strictEqual(entry.fileComment, "😃");
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

    const entry = new TestZipEntry();
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.fileComment, "ABC");
    assert.strictEqual(entry.fileName, "🥺");
    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
    assert.strictEqual(entry.localHeaderOffset, 0x010203010203);
  });
});

describe("readExtraFields()", () => {
  it("can read a unicode comment field", () => {
    const entry = new TestZipEntry();
    entry.fileComment = "hello world";

    const buffer = data(
      "7563", // tag: Info-ZIP Unicode Comment Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.fileComment, "ABC");
  });

  it("can read a unicode path field", () => {
    const entry = new TestZipEntry();
    entry.fileName = "hello world";

    const buffer = data(
      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.fileName, "ABC");
  });

  it("ignores unicode path field if the CRC32 does not match", () => {
    const entry = new TestZipEntry();
    entry.fileName = "hello world";

    const buffer = data(
      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "01020304", // random crc
      "414243", // data: ABC
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.fileName, "hello world");
  });

  it("ignores unicode comment field if the header comment is not set", () => {
    const entry = new TestZipEntry();

    const buffer = data(
      "7563", // tag: Info-ZIP Unicode Comment Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.fileComment, "");
  });

  it("throws if the unicode path field version is not 1", () => {
    const entry = new TestZipEntry();
    entry.fileName = "hello world";

    const buffer = data(
      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0800", // size: 8 bytes
      "02", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    assert.throws(() => {
      readExtraFields(entry, buffer);
    });
  });

  it("can read sizes from a Zip64 extended info field", () => {
    const entry = new TestZipEntry();
    entry.compressedSize = 0xffffffff;
    entry.uncompressedSize = 0xffffffff;

    const buffer = data(
      "0100", // tag: Zip64 extended information extra field
      "1000", // size: 16 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
  });

  it("can read sizes and offset from a Zip64 extended info field", () => {
    const entry = new TestZipEntry();
    entry.compressedSize = 0xffffffff;
    entry.uncompressedSize = 0xffffffff;
    entry.localHeaderOffset = 0xffffffff;

    const buffer = data(
      "0100", // tag: Zip64 extended information extra field
      "1800", // size: 24 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size
      "0302010302010000", // local header offset
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
    assert.strictEqual(entry.localHeaderOffset, 0x010203010203);
  });

  it("throws if value in Zip64 extended info field is too large for Number", () => {
    const entry = new TestZipEntry();
    entry.compressedSize = 0xffffffff;

    const buffer = data(
      "0100", // tag: Zip64 extended information extra field
      "0800", // size: 24 bytes
      "01020304050600ff", // compressed size
    );

    assert.throws(
      () => {
        readExtraFields(entry, buffer);
      },
      (error) => {
        assert(error instanceof RangeError);
        return true;
      },
    );
  });

  it("can read three fields together", () => {
    const entry = new TestZipEntry();
    entry.fileComment = "hello";
    entry.fileName = "world";
    entry.compressedSize = 0xffffffff;
    entry.uncompressedSize = 0xffffffff;
    entry.localHeaderOffset = 0xffffffff;

    const buffer = data(
      "7563", // tag: Info-ZIP Unicode Comment Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "86a61036", // crc of "hello"
      "414243", // data: ABC

      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0900", // size: 9 bytes
      "01", // version
      "4311773a", // crc of "world"
      "f09fa5ba", // data: 🥺

      "0100", // tag: Zip64 extended information extra field
      "1800", // size: 24 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size
      "0302010302010000", // local header offset
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.fileComment, "ABC");
    assert.strictEqual(entry.fileName, "🥺");
    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
    assert.strictEqual(entry.localHeaderOffset, 0x010203010203);
  });

  it("can skip over unknown fields", () => {
    const entry = new TestZipEntry();
    entry.compressedSize = 0xffffffff;
    entry.uncompressedSize = 0xffffffff;

    const buffer = data(
      "ff99", // nonsense
      "0a00", // ten more bytes of nonsense to come
      "0102030405060708090a", // nonsense

      "0100", // tag: Zip64 extended information extra field
      "1000", // size: 16 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size
    );

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
  });

  it("can read from the middle of a buffer", () => {
    const entry = new TestZipEntry();
    entry.compressedSize = 0xffffffff;
    entry.uncompressedSize = 0xffffffff;

    const buffer = data(
      "0102030405060708090a", // nonsense

      "0100", // tag: Zip64 extended information extra field
      "1000", // size: 16 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size

      "abcdef", // nonsense
    );

    readExtraFields(entry, buffer, 10, 20);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
  });
});

class TestZipEntry implements ZipEntry {
  public platformMadeBy = ZipPlatform.DOS;
  public versionMadeBy = ZipVersion.Zip64;
  public versionNeeded = ZipVersion.Zip64;
  public readonly flags = new GeneralPurposeFlags();
  public compressionMethod = CompressionMethod.Deflate;
  public lastModified = new Date();
  public crc32 = 0;
  public compressedSize = 0;
  public uncompressedSize = 0;
  public fileNameLength = 0;
  public extraFieldLength = 0;
  public fileCommentLength = 0;
  public internalFileAttributes = 0;
  public externalFileAttributes?: DosFileAttributes | UnixFileAttributes;
  public localHeaderOffset = 0;
  public fileName = "";
  public fileComment = "";

  public get totalRecordLength(): number {
    return (
      CentralHeaderLength +
      this.fileNameLength +
      this.extraFieldLength +
      this.fileCommentLength
    );
  }
}
