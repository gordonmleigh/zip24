import assert from "node:assert";
import { describe, it } from "node:test";
import {
  bigUint,
  cp437,
  data,
  dosDate,
  hex,
  longUint,
  shortUint,
  utf8,
  utf8length,
} from "../testing/data.js";
import { ZipSignatureError } from "./errors.js";
import {
  CompressionMethod,
  GeneralPurposeFlags,
  ZipVersion,
} from "./field-types.js";
import { readLocalHeaderSize, writeLocalHeader } from "./local-entry.js";
import type { RawLocalHeader } from "./records.js";

describe("readLocalHeaderSize", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      /* 00 +04 */ "ffffffff", // signature  (0x04034b50)
      /* 04 +02 */ "1500", // version needed (21 = 2.1)
      /* 06 +02 */ "4100", // flags
      /* 08 +02 */ "0800", // compression method (8 = DEFLATE)
      /* 10 +02 */ "6a51", // last mod file time (10:11:20)
      /* 12 +02 */ "a656", // last mod file date, (2023-05-06)
      /* 14 +04 */ "12345678", // crc-32
      /* 18 +04 */ "87654321", // compressed size
      /* 22 +04 */ "12348765", // uncompressed size
      /* 26 +02 */ "0800", // file name length
      /* 28 +02 */ "0000", // extra field length
      /* 30 +08 */ cp437`ôöò/path`, // file name
      /* 38 +00 */ "", // extra field
    );

    assert.throws(
      () => {
        readLocalHeaderSize(buffer);
      },
      (error) => error instanceof ZipSignatureError,
    );
  });

  it("returns the total record length", () => {
    const buffer = data(
      "787cdb53a824260cbe32f44f795ac791",
      "9cb2a9d1be27c02c893728b7456ace9f", // nonsense (32 bytes)

      /* 00 +04 */ "504b0304", // signature  (0x04034b50)
      /* 04 +02 */ "1500", // version needed (21 = 2.1)
      /* 06 +02 */ "4100", // flags
      /* 08 +02 */ "0800", // compression method (8 = DEFLATE)
      /* 10 +02 */ "6a51", // last mod file time (10:11:20)
      /* 12 +02 */ "a656", // last mod file date, (2023-05-06)
      /* 14 +04 */ "12345678", // crc-32
      /* 18 +04 */ "87654321", // compressed size
      /* 22 +04 */ "12348765", // uncompressed size
      /* 26 +02 */ "0800", // file name length
      /* 28 +02 */ "0d00", // extra field length
      /* 30 +08 */ cp437`ôöò/path`, // file name

      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0900", // size: 9 bytes
      "01", // version
      "4311773a", // crc of "world"
      utf8`🥺`, // data
    );

    const result = readLocalHeaderSize(buffer, 32);
    assert.strictEqual(result, 51);
  });
});

describe("writeLocalHeader", () => {
  it("writes all the basic fields", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.UtfEncoding,
    };

    const expected = hex(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.UtfEncoding), // version needed to extract
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

    const result = writeLocalHeader(entry);

    assert.strictEqual(hex(result), expected);
  });

  it("includes the extra field data if given", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.UtfEncoding,
      extraField: utf8`random rubbish`,
    };

    const expected = hex(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.UtfEncoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(1234), // compressed size
      longUint(4321), // uncompressed size
      utf8length`hello/world`, // file name length
      utf8length`random rubbish`, // extra field length
      utf8`hello/world`, // file name
      utf8`random rubbish`, // extra field
    );

    const result = writeLocalHeader(entry);

    assert.strictEqual(hex(result), expected);
  });

  it("masks size and crc32 fields when hasDataDescriptor flag is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.UtfEncoding,
      extraField: utf8`random rubbish`,
    };

    const expected = hex(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.UtfEncoding), // version needed to extract
      shortUint(8), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(0), // crc32
      longUint(0), // compressed size
      longUint(0), // uncompressed size
      utf8length`hello/world`, // file name length
      utf8length`random rubbish`, // extra field length
      utf8`hello/world`, // file name
      utf8`random rubbish`, // extra field
    );

    const result = writeLocalHeader(entry);

    assert.strictEqual(hex(result), expected);
  });

  it("writes zip64 field when zip64 option is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.UtfEncoding,
    };

    const expected = hex(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.UtfEncoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(0xffff_ffff), // compressed size
      longUint(0xffff_ffff), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(20), // extra field length
      utf8`hello/world`, // file name

      // extra field
      shortUint(1),
      shortUint(16),
      bigUint(4321),
      bigUint(1234),
    );

    const result = writeLocalHeader(entry, { zip64: true });

    assert.strictEqual(hex(result), expected);
  });

  it("appends zip64 field to existing extraField when zip64 option is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasUtf8Strings = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      extraField: utf8`hello`,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.UtfEncoding,
    };

    const expected = hex(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.UtfEncoding), // version needed to extract
      shortUint(0x800), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(9087345), // crc32
      longUint(0xffff_ffff), // compressed size
      longUint(0xffff_ffff), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(25), // extra field length
      utf8`hello/world`, // file name

      // extra field
      utf8`hello`,

      shortUint(1),
      shortUint(16),
      bigUint(4321),
      bigUint(1234),
    );

    const result = writeLocalHeader(entry, { zip64: true });

    assert.strictEqual(hex(result), expected);
  });

  it("writes masked zip64 field when zip64 option and hasDataDescriptor flag is set", () => {
    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = true;

    const entry: RawLocalHeader = {
      compressedSize: 1234,
      compressionMethod: CompressionMethod.Deflate,
      crc32: 9087345,
      flags,
      lastModified: new Date("2021-11-15T13:15:22Z"),
      path: utf8`hello/world`,
      uncompressedSize: 4321,
      versionNeeded: ZipVersion.UtfEncoding,
    };

    const expected = hex(
      longUint(0x04034b50), // signature
      shortUint(ZipVersion.UtfEncoding), // version needed to extract
      shortUint(8), // flags
      shortUint(CompressionMethod.Deflate), // compression method
      dosDate`2021-11-15T13:15:22Z`, // last modified
      longUint(0), // crc32
      longUint(0xffff_ffff), // compressed size
      longUint(0xffff_ffff), // uncompressed size
      utf8length`hello/world`, // file name length
      shortUint(20), // extra field length
      utf8`hello/world`, // file name

      // extra field
      shortUint(1),
      shortUint(16),
      bigUint(0),
      bigUint(0),
    );

    const result = writeLocalHeader(entry, { zip64: true });

    assert.strictEqual(hex(result), expected);
  });
});
