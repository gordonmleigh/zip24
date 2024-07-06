import assert from "node:assert";
import { describe, it } from "node:test";
import { assertBufferEqual } from "../test-util/assert.js";
import {
  bigUint,
  cp437,
  cp437length,
  data,
  dosDate,
  longUint,
  shortUint,
  tinyUint,
  utf8,
  utf8length,
} from "../test-util/data.js";
import { CentralDirectoryHeader } from "./central-directory-header.js";
import { CompressionMethod } from "./compression-core.js";
import { ExtraFieldTag, ZipPlatform, ZipVersion } from "./constants.js";
import { MultiDiskError, ZipFormatError, ZipSignatureError } from "./errors.js";
import {
  ExtraFieldCollection,
  UnicodeExtraField,
} from "./extra-field-collection.js";
import { UnixFileAttributes } from "./file-attributes.js";
import { GeneralPurposeFlags } from "./flags.js";

describe("core/central-directory-header", () => {
  describe("class CentralDirectoryHeader", () => {
    describe(".deserialize()", () => {
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
            CentralDirectoryHeader.deserialize(buffer);
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

        const entry = CentralDirectoryHeader.deserialize(buffer);

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

        assert.strictEqual(entry.localHeaderOffset, 0x12efcdab);
        assert.strictEqual(entry.attributes.value, 0x81a4);

        assert.strictEqual(entry.path, "ôöò/path");
        assert.strictEqual(entry.comment, "☺☻♥♦♣♠");

        assert.strictEqual(entry.totalSize, 46 + 8 + 6);
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
            CentralDirectoryHeader.deserialize(buffer);
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

        const entry = CentralDirectoryHeader.deserialize(buffer);

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

        const entry = CentralDirectoryHeader.deserialize(buffer);

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

        assert.throws(
          () => {
            CentralDirectoryHeader.deserialize(buffer);
          },
          (error) => error instanceof MultiDiskError,
        );
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

        const entry = CentralDirectoryHeader.deserialize(buffer);

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

        const entry = CentralDirectoryHeader.deserialize(buffer);

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
          bigUint(0x665544332211), // uncompressed size
          bigUint(0x44332211aabb), // compressed size
          bigUint(0xffeeddccbbaa), // local header offset

          cp437`hello`, // the comment
        );

        const entry = CentralDirectoryHeader.deserialize(buffer);
        assert.strictEqual(entry.totalSize, 46 + 5 + 53 + 5);

        const commentField = entry.extraField.getField(
          ExtraFieldTag.UnicodeCommentField,
        );
        assert.strictEqual(commentField?.value, "ABC");

        const pathField = entry.extraField.getField(
          ExtraFieldTag.UnicodePathField,
        );
        assert.strictEqual(pathField?.value, "🥺");

        const zip64Field = entry.extraField.getField(
          ExtraFieldTag.Zip64ExtendedInfo,
        );
        assert.deepStrictEqual(
          zip64Field?.values,
          [0x665544332211, 0x44332211aabb, 0xffeeddccbbaa],
        );

        assert.strictEqual(entry.comment, "ABC");
        assert.strictEqual(entry.path, "🥺");

        assert.strictEqual(entry.uncompressedSize, 0x665544332211);
        assert.strictEqual(entry.compressedSize, 0x44332211aabb);
        assert.strictEqual(entry.localHeaderOffset, 0xffeeddccbbaa);
      });
    });

    describe(".readTotalSize()", () => {
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
            CentralDirectoryHeader.readTotalSize(buffer);
          },
          (error) => error instanceof ZipSignatureError,
        );
      });

      it("returns the correct size", () => {
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
          /* 30 +02 */ "0500", // extra field length
          /* 32 +02 */ "0600", // file comment length
          /* 34 +02 */ "0000", // disk number start
          /* 36 +02 */ "0000", // internal file attributes
          /* 38 +04 */ "0000a481", // external file attributes
          /* 42 +04 */ "abcdef12", // relative offset of local header
          /* 46 +08 */ cp437`ôöò/path`, // file name
          /* 54 +00 */ "0000010001", // extra field
          /* 54 +11 */ "010203040506", // the comment
        );

        const result = CentralDirectoryHeader.readTotalSize(buffer);
        assert.strictEqual(result, 46 + 8 + 5 + 6);
      });
    });

    describe("#serialize()", () => {
      it("writes all the basic fields", () => {
        const entry = new CentralDirectoryHeader({
          attributes: new UnixFileAttributes(0o10_755),
          comment: "the file comment ☻",
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField: new ExtraFieldCollection(),
          flags: new GeneralPurposeFlags(),
          lastModified: new Date("2021-11-15T13:15:22Z"),
          localHeaderOffset: 298374,
          path: "hello world ♥",
          uncompressedSize: 4321,
          versionMadeBy: ZipVersion.Zip64,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

        const expected = data(
          longUint(0x02014b50), // signature
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed to extract
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2021-11-15T13:15:22Z`, // last modified
          longUint(9087345), // crc32
          longUint(1234), // compressed size
          longUint(4321), // uncompressed size
          cp437length`hello world ♥`, // file name length
          shortUint(0), // extra field length
          cp437length`the file comment ☻`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint((0o10_755 << 16) >>> 0), // external file attributes
          longUint(298374), // relative offset of local header
          cp437`hello world ♥`, // file name
          "", // extra field
          cp437`the file comment ☻`, // file comment
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });

      it("it utf8 encodes strings when the hasUtf8Strings flag is set", () => {
        const flags = new GeneralPurposeFlags();
        flags.hasUtf8Strings = true;

        const entry = new CentralDirectoryHeader({
          attributes: new UnixFileAttributes(0o10_755),
          comment: "the file comment 🙂",
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField: new ExtraFieldCollection(),
          flags,
          lastModified: new Date("2021-11-15T13:15:22Z"),
          localHeaderOffset: 298374,
          path: "hello world 👋",
          uncompressedSize: 4321,
          versionMadeBy: ZipVersion.Zip64,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

        const expected = data(
          longUint(0x02014b50), // signature
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed to extract
          shortUint(0x800), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2021-11-15T13:15:22Z`, // last modified
          longUint(9087345), // crc32
          longUint(1234), // compressed size
          longUint(4321), // uncompressed size
          utf8length`hello world 👋`, // file name length
          shortUint(0), // extra field length
          utf8length`the file comment 🙂`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint((0o10_755 << 16) >>> 0), // external file attributes
          longUint(298374), // relative offset of local header
          utf8`hello world 👋`, // file name
          "", // extra field
          utf8`the file comment 🙂`, // file comment
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });

      it("includes the extra field data if given", () => {
        const extraField = new ExtraFieldCollection();
        extraField.fields.push(
          new UnicodeExtraField(
            ExtraFieldTag.UnicodePathField,
            0x12345678,
            "unicode",
          ),
        );

        const entry = new CentralDirectoryHeader({
          attributes: new UnixFileAttributes(0o10_755),
          comment: "the file comment",
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField,
          flags: new GeneralPurposeFlags(),
          lastModified: new Date("2021-11-15T13:15:22Z"),
          localHeaderOffset: 298374,
          path: "hello/world",
          uncompressedSize: 4321,
          versionMadeBy: ZipVersion.Zip64,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

        const expected = data(
          longUint(0x02014b50), // signature
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed to extract
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2021-11-15T13:15:22Z`, // last modified
          longUint(9087345), // crc32
          longUint(1234), // compressed size
          longUint(4321), // uncompressed size
          cp437length`hello/world`, // file name length
          shortUint(4 + 5 + 7), // extra field length
          cp437length`the file comment`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint((0o10_755 << 16) >>> 0), // external file attributes
          longUint(298374), // relative offset of local header

          // file name
          cp437`hello/world`, // file name

          // extra field
          shortUint(ExtraFieldTag.UnicodePathField), // tag
          shortUint(5 + 7), // data size
          tinyUint(1), // version
          longUint(0x12345678), // crc32
          utf8`unicode`,

          // file comment
          cp437`the file comment`,
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });

      it("write zip64 format if zip64 is set", () => {
        const extraField = new ExtraFieldCollection();
        extraField.fields.push(
          new UnicodeExtraField(
            ExtraFieldTag.UnicodePathField,
            0x12345678,
            "unicode",
          ),
        );

        const entry = new CentralDirectoryHeader({
          attributes: new UnixFileAttributes(0o10_755),
          comment: "the file comment",
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField,
          flags: new GeneralPurposeFlags(),
          lastModified: new Date("2021-11-15T13:15:22Z"),
          localHeaderOffset: 298374,
          path: "hello/world",
          uncompressedSize: 4321,
          versionMadeBy: ZipVersion.Zip64,
          versionNeeded: ZipVersion.Utf8Encoding,
          zip64: true,
        });

        const expected = data(
          longUint(0x02014b50), // signature
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed to extract
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2021-11-15T13:15:22Z`, // last modified
          longUint(9087345), // crc32
          longUint(0xffff_ffff), // compressed size
          longUint(0xffff_ffff), // uncompressed size
          cp437length`hello/world`, // file name length
          shortUint(4 + 5 + 7 + 4 + 24), // extra field length
          cp437length`the file comment`, // file comment length
          shortUint(0), // disk number start
          shortUint(0), // internal file attributes
          longUint((0o10_755 << 16) >>> 0), // external file attributes
          longUint(0xffff_ffff), // relative offset of local header

          // +46 file name
          cp437`hello/world`, // file name

          // +57 extra field 1
          shortUint(ExtraFieldTag.UnicodePathField), // tag
          shortUint(5 + 7), // data size
          tinyUint(1), // version
          longUint(0x12345678), // crc32
          utf8`unicode`,

          // +73 extra field 2
          shortUint(ExtraFieldTag.Zip64ExtendedInfo), // tag
          shortUint(24), // data size
          bigUint(4321), // uncompressed size
          bigUint(1234), // compressed size
          bigUint(298374), // local header offset

          // file comment
          cp437`the file comment`,
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });
    });
  });
});
