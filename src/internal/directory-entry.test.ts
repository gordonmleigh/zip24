import assert from "node:assert";
import { describe, it } from "node:test";
import { cp437, data, utf8 } from "../testing/data.js";
import {
  getDirectoryHeaderLength,
  readDirectoryEntry,
  readDirectoryVariableFields,
} from "./directory-entry.js";
import { ZipFormatError, ZipSignatureError } from "./errors.js";
import {
  CompressionMethod,
  DosDate,
  DosFileAttributes,
  GeneralPurposeFlags,
  ZipPlatform,
  ZipVersion,
} from "./field-types.js";
import type { CentralHeaderLengthFields } from "./records.js";

describe("readDirectoryEntry()", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      /* 00 +04 */ "ffffffff", // signature  (0x02014b50)
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

    assert.throws(
      () => {
        readDirectoryEntry({}, buffer);
      },
      (error) => error instanceof ZipSignatureError,
    );
  });

  it("can read a header", () => {
    const buffer = data(
      /* 00 +04 */ "504b0102", // signature  (0x02014b50)
      /* 04 +02 */ "1403", // version made by (20 = 2.0), platform (3 = Unix)
      /* 06 +02 */ "1400", // version needed (20 = 2.0)
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

    const entry = {};
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.versionMadeBy, ZipVersion.Deflate);
    assert.strictEqual(entry.platformMadeBy, ZipPlatform.UNIX);
    assert.strictEqual(entry.versionNeeded, ZipVersion.Deflate);
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

    assert.strictEqual(entry.pathLength, 8);
    assert.strictEqual(entry.extraFieldLength, 0);
    assert.strictEqual(entry.commentLength, 6);

    assert.strictEqual(entry.localHeaderOffset, 0x12efcdab);
    assert.strictEqual(entry.attributes.value, 0x81a4);

    assert.strictEqual(getDirectoryHeaderLength(entry), 46 + 8 + 0 + 6);

    assert.strictEqual(entry.path, "ôöò/path");
    assert.strictEqual(entry.comment, "☺☻♥♦♣♠");
  });

  it("throws if the platform is unknown", () => {
    const buffer = data(
      /* 00 +04 */ "504b0102", // signature  (0x02014b50)
      /* 04 +02 */ "15ff", // version made by (21 = 2.1), platform (ff = ?)
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

    assert.throws(
      () => {
        readDirectoryEntry({}, buffer);
      },
      (error) =>
        error instanceof ZipFormatError &&
        error.message === "unknown platform 255",
    );
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

    const entry = {};
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.platformMadeBy, ZipPlatform.UNIX);
    assert.strictEqual(entry.attributes.value, 0x81a4);
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

    const entry = {};
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.platformMadeBy, ZipPlatform.DOS);
    assert.strictEqual(entry.attributes.value, 0x11);
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

    assert.throws(() => {
      readDirectoryEntry({}, buffer);
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

    const entry = {};
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.path, "≡ƒÑ║");
    assert.strictEqual(entry.comment, "≡ƒÿâ");
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

    const entry = {};
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.path, "🥺");
    assert.strictEqual(entry.comment, "😃");
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

    const entry = {};
    readDirectoryEntry(entry, buffer);

    assert.strictEqual(entry.comment, "ABC");
    assert.strictEqual(entry.path, "🥺");
    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
    assert.strictEqual(entry.localHeaderOffset, 0x010203010203);
  });
});

describe("readDirectoryVariableFields", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      /* 00 +04 */ "ffffffff", // signature  (0x02014b50)
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

    assert.throws(
      () => {
        readDirectoryVariableFields(
          {
            attributes: new DosFileAttributes(),
            commentLength: 0,
            compressedSize: 0,
            compressionMethod: CompressionMethod.Stored,
            crc32: 0,
            extraFieldLength: 0,
            flags: new GeneralPurposeFlags(),
            internalAttributes: 0,
            lastModified: new DosDate(0),
            localHeaderOffset: 0,
            pathLength: 0,
            platformMadeBy: ZipPlatform.DOS,
            uncompressedSize: 0,
            versionMadeBy: ZipVersion.Deflate,
            versionNeeded: ZipVersion.Deflate,
          },
          buffer,
        );
      },
      (error) => error instanceof ZipSignatureError,
    );
  });
});

describe("getDirectoryHeaderLength()", () => {
  it("returns the sum of the fixed and variable field lengths", () => {
    const entry: CentralHeaderLengthFields = {
      commentLength: 17,
      extraFieldLength: 23,
      pathLength: 47,
    };

    const result = getDirectoryHeaderLength(entry);
    assert.strictEqual(result, 133);
  });
});
