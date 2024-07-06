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
import { CompressionMethod } from "./compression-core.js";
import { ExtraFieldTag, ZipVersion } from "./constants.js";
import { ZipSignatureError } from "./errors.js";
import {
  ExtraFieldCollection,
  UnicodeExtraField,
} from "./extra-field-collection.js";
import { GeneralPurposeFlags } from "./flags.js";
import { LocalFileHeader } from "./local-file-header.js";

describe("core/local-file-header", () => {
  describe("class LocalFileHeader", () => {
    describe(".deserialize()", () => {
      it("throws if the signature is invalid", () => {
        const buffer = data(
          longUint(0xffffffff), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0x800), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0x87654321), // compressed size
          longUint(0x87651234), // uncompressed size
          utf8length`päth`, // file name length
          shortUint(0), // extra field length
          utf8`päth`, // file name
          "", // extra field
        );

        assert.throws(
          () => {
            LocalFileHeader.deserialize(buffer);
          },
          (error) => error instanceof ZipSignatureError,
        );
      });

      it("can read a header", () => {
        const buffer = data(
          longUint(0x04034b50), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0x87654321), // compressed size
          longUint(0x87651234), // uncompressed size
          cp437length`hello world ♥`, // file name length
          shortUint(0), // extra field length
          cp437`hello world ♥`, // file name
          "", // extra field
        );

        const entry = LocalFileHeader.deserialize(buffer);

        assert.strictEqual(entry.versionNeeded, ZipVersion.Zip64);
        assert.strictEqual(entry.flags.value, 0);

        assert.strictEqual(entry.compressionMethod, CompressionMethod.Deflate);

        assert.strictEqual(
          entry.lastModified.toISOString(),
          "2023-04-05T11:22:34.000Z",
        );

        assert.strictEqual(entry.crc32, 0x12345678);
        assert.strictEqual(entry.compressedSize, 0x87654321);
        assert.strictEqual(entry.uncompressedSize, 0x87651234);

        assert.strictEqual(entry.path, "hello world ♥");
      });

      it("decodes the path as utf-8 if the unicode flag is set", () => {
        const buffer = data(
          longUint(0x04034b50), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0x800), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0x87654321), // compressed size
          longUint(0x87651234), // uncompressed size
          utf8length`hello world 👋`, // file name length
          shortUint(0), // extra field length
          utf8`hello world 👋`, // file name
          "", // extra field
        );

        const entry = LocalFileHeader.deserialize(buffer);

        assert.strictEqual(entry.versionNeeded, ZipVersion.Zip64);
        assert(entry.flags.hasUtf8Strings);

        assert.strictEqual(entry.compressionMethod, CompressionMethod.Deflate);

        assert.strictEqual(
          entry.lastModified.toISOString(),
          "2023-04-05T11:22:34.000Z",
        );

        assert.strictEqual(entry.crc32, 0x12345678);
        assert.strictEqual(entry.compressedSize, 0x87654321);
        assert.strictEqual(entry.uncompressedSize, 0x87651234);

        assert.strictEqual(entry.path, "hello world 👋");
      });

      it("decodes extra fields", () => {
        const buffer = data(
          longUint(0x04034b50), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0x87654321), // compressed size
          longUint(0x87651234), // uncompressed size
          cp437length`world`, // file name length
          shortUint(13), // extra field length
          cp437`world`, // file name

          shortUint(ExtraFieldTag.UnicodePathField), // tag: Info-ZIP Unicode Path Extra Field
          shortUint(9), // size: 9 bytes
          tinyUint(1), // version
          longUint(0x3a771143), // crc of "world"
          utf8`🥺`, // data
        );

        const entry = LocalFileHeader.deserialize(buffer);

        const pathField = entry.extraField.getField(
          ExtraFieldTag.UnicodePathField,
        );
        assert.strictEqual(pathField?.value, "🥺");
      });

      it("decodes zip64 fields", () => {
        const buffer = data(
          longUint(0x04034b50), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0xffff_ffff), // compressed size
          longUint(0xffff_ffff), // uncompressed size
          cp437length`world`, // file name length
          shortUint(4 + 16), // extra field length
          cp437`world`, // file name

          shortUint(ExtraFieldTag.Zip64ExtendedInfo), // tag: Info-ZIP Unicode Path Extra Field
          shortUint(16), // size: 9 bytes
          bigUint(0x87651234), // uncompressed size
          bigUint(0x87654321), // compressed size
        );

        const entry = LocalFileHeader.deserialize(buffer);
        assert.strictEqual(entry.uncompressedSize, 0x87651234);
        assert.strictEqual(entry.compressedSize, 0x87654321);
      });
    });

    describe(".readTotalSize()", () => {
      it("throws if the signature is invalid", () => {
        const buffer = data(
          longUint(0xffffffff), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0x87654321), // compressed size
          longUint(0x87651234), // uncompressed size
          cp437length`hello world ♥`, // file name length
          shortUint(0), // extra field length
          cp437`hello world ♥`, // file name
        );

        assert.throws(
          () => {
            LocalFileHeader.readTotalSize(buffer);
          },
          (error) => error instanceof ZipSignatureError,
        );
      });

      it("returns the total record length", () => {
        const buffer = data(
          "787cdb53a824260cbe32f44f795ac791",
          "9cb2a9d1be27c02c893728b7456ace9f", // nonsense (32 bytes)

          longUint(0x04034b50), // signature
          shortUint(ZipVersion.Zip64), // version needed
          shortUint(0), // flags
          shortUint(CompressionMethod.Deflate), // compression method
          dosDate`2023-04-05T11:22:34Z`, // last modified
          longUint(0x12345678), // crc-32
          longUint(0x87654321), // compressed size
          longUint(0x87651234), // uncompressed size
          cp437length`hello world ♥`, // file name length
          shortUint(123), // extra field length
          cp437`hello world ♥`, // file name
        );

        const result = LocalFileHeader.readTotalSize(buffer, 32);
        assert.strictEqual(result, 30 + 13 + 123);
      });
    });

    describe("#serialize()", () => {
      it("writes all the basic fields", () => {
        const flags = new GeneralPurposeFlags();
        flags.hasUtf8Strings = true;

        const entry = new LocalFileHeader({
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField: new ExtraFieldCollection(),
          flags,
          lastModified: new Date("2021-11-15T13:15:22Z"),
          path: "hello/world",
          uncompressedSize: 4321,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

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

        const flags = new GeneralPurposeFlags();
        flags.hasUtf8Strings = true;

        const entry = new LocalFileHeader({
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField,
          flags,
          lastModified: new Date("2021-11-15T13:15:22Z"),
          path: "hello/world",
          uncompressedSize: 4321,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

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
          shortUint(4 + 5 + 7), // extra field length

          // file name
          cp437`hello/world`, // file name

          // extra field
          shortUint(ExtraFieldTag.UnicodePathField), // tag
          shortUint(5 + 7), // data size
          tinyUint(1), // version
          longUint(0x12345678), // crc32
          utf8`unicode`,
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });

      it("includes the a zip64 extra field if zip64 is set", () => {
        const extraField = new ExtraFieldCollection();

        extraField.fields.push(
          new UnicodeExtraField(
            ExtraFieldTag.UnicodePathField,
            0x12345678,
            "unicode",
          ),
        );

        const flags = new GeneralPurposeFlags();
        flags.hasUtf8Strings = true;

        const entry = new LocalFileHeader({
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField,
          flags,
          lastModified: new Date("2021-11-15T13:15:22Z"),
          path: "hello/world",
          uncompressedSize: 4321,
          versionNeeded: ZipVersion.Utf8Encoding,
          zip64: true,
        });

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
          shortUint(4 + 5 + 7 + 4 + 16), // extra field length

          // file name
          cp437`hello/world`, // file name

          // extra field 1
          shortUint(ExtraFieldTag.UnicodePathField), // tag
          shortUint(5 + 7), // data size
          tinyUint(1), // version
          longUint(0x12345678), // crc32
          utf8`unicode`,

          // extra field 2
          shortUint(ExtraFieldTag.Zip64ExtendedInfo), // tag
          shortUint(16), // data size
          bigUint(4321), // uncompressed size
          bigUint(1234), // compressed size
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });

      it("masks size and crc32 fields when hasDataDescriptor flag is set", () => {
        const flags = new GeneralPurposeFlags();
        flags.hasDataDescriptor = true;

        const entry = new LocalFileHeader({
          compressedSize: 1234,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 9087345,
          extraField: new ExtraFieldCollection(),
          flags,
          lastModified: new Date("2021-11-15T13:15:22Z"),
          path: "hello/world",
          uncompressedSize: 4321,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

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
          shortUint(0), // extra field length
          utf8`hello/world`, // file name
        );

        const result = entry.serialize();

        assertBufferEqual(result, expected);
      });
    });
  });
});
