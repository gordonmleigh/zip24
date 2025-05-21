import assert from "node:assert";
import { text } from "node:stream/consumers";
import { describe, it } from "node:test";
import {
  ZipEntry,
  ZipEntryBase,
  ZipEntryReader,
  minimumVersion,
  needs64bit,
  needsDataDescriptor,
  needsUtf8,
} from "./entry.ts";
import { ZipFormatError } from "./errors.ts";
import { CentralDirectoryHeader } from "./raw/central-directory-header.ts";
import { CompressionMethod, ZipVersion } from "./raw/constants.ts";
import {
  ExtraFieldCollection,
  Zip64ExtraField,
} from "./raw/extra-field-collection.ts";
import {
  DosFileAttributes,
  UnixFileAttributes,
} from "./raw/file-attributes.ts";
import { GeneralPurposeFlags } from "./raw/flags.ts";

describe("exports/entry", () => {
  describe("class ZipEntryBase", () => {
    describe("constructor", () => {
      it("sets all the instance properties", () => {
        const extraField = new ExtraFieldCollection([]);

        const entry = new ZipEntryBase({
          attributes: new DosFileAttributes(DosFileAttributes.System),
          comment: "the comment goes here",
          compressedSize: 0x11223344,
          compressionMethod: CompressionMethod.Deflate,
          crc32: 0x55667788,
          extraField,
          flags: new GeneralPurposeFlags(GeneralPurposeFlags.HasEncryption),
          lastModified: new Date(1747586332724),
          localHeaderOffset: 0x44332211,
          path: "here is the path",
          uncompressedSize: 0x88776655,
          versionMadeBy: ZipVersion.Utf8Encoding,
          versionNeeded: ZipVersion.Deflate,
        });

        assert.strictEqual(entry.attributes.value, DosFileAttributes.System);
        assert.strictEqual(entry.comment, "the comment goes here");
        assert.strictEqual(entry.compressedSize, 0x11223344);
        assert.strictEqual(entry.compressionMethod, CompressionMethod.Deflate);
        assert.strictEqual(entry.crc32, 0x55667788);
        assert.strictEqual(entry.extraField, extraField);
        assert.strictEqual(
          entry.flags.value,
          GeneralPurposeFlags.HasEncryption,
        );
        assert.strictEqual(entry.lastModified.getTime(), 1747586332724);
        assert.strictEqual(entry.localHeaderOffset, 0x44332211);
        assert.strictEqual(entry.path, "here is the path");
        assert.strictEqual(entry.uncompressedSize, 0x88776655);
        assert.strictEqual(entry.versionMadeBy, ZipVersion.Utf8Encoding);
        assert.strictEqual(entry.versionNeeded, ZipVersion.Deflate);
      });
    });
  });

  describe("class ZipEntry", () => {
    describe("get isDirectory", () => {
      it("returns true if the entry is a unix directory", () => {
        const attributes = new UnixFileAttributes();
        attributes.isDirectory = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isDirectory, true);
      });

      it("returns false if the entry is a unix file", () => {
        const attributes = new UnixFileAttributes();
        attributes.isFile = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isDirectory, false);
      });

      it("returns true if the entry is a dos directory", () => {
        const attributes = new DosFileAttributes();
        attributes.isDirectory = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isDirectory, true);
      });

      it("returns false if the entry is a dos file", () => {
        const attributes = new DosFileAttributes();
        attributes.isFile = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isDirectory, false);
      });

      it("returns true if the entry path ends with a slash", () => {
        const entry = new ZipEntry({ path: "directory/" });

        assert.strictEqual(entry.isDirectory, true);
      });
    });

    describe("get isFile", () => {
      it("returns false if the entry is a unix directory", () => {
        const attributes = new UnixFileAttributes();
        attributes.isDirectory = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isFile, false);
      });

      it("returns true if the entry is a unix file", () => {
        const attributes = new UnixFileAttributes();
        attributes.isFile = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isFile, true);
      });

      it("returns false if the entry is a dos directory", () => {
        const attributes = new DosFileAttributes();
        attributes.isDirectory = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isFile, false);
      });

      it("returns true if the entry is a dos file", () => {
        const attributes = new DosFileAttributes();
        attributes.isFile = true;

        const entry = new ZipEntry({ attributes });

        assert.strictEqual(entry.isFile, true);
      });

      it("returns false if the entry path ends with a slash", () => {
        const entry = new ZipEntry({ path: "directory/" });

        assert.strictEqual(entry.isFile, false);
      });
    });

    describe("constructor()", () => {
      it("throws if the provided crc32 is invalid", () => {
        assert.throws(
          () => new ZipEntry({ crc32: 123 }, Buffer.from("hello world")),
        );
      });

      it("throws if the provided uncompressedSize is invalid", () => {
        assert.throws(
          () =>
            new ZipEntry({ uncompressedSize: 10 }, Buffer.from("hello world")),
        );
      });

      it("throws if the uncompressedSize and crc32 is not given with compressedData", () => {
        assert.throws(
          () =>
            new ZipEntry({
              uncompressedSize: 11,
              compressedData: Buffer.from("hello world"),
            }),
        );
        assert.throws(
          () =>
            new ZipEntry({
              crc32: 11,
              compressedData: Buffer.from("hello world"),
            }),
        );
        assert.doesNotThrow(
          () =>
            new ZipEntry({
              uncompressedSize: 11,
              crc32: 11,
              compressedData: Buffer.from("hello world"),
            }),
        );
      });

      it("sets compression method to Stored if the data is empty", () => {
        const entry = new ZipEntry({}, new Uint8Array());
        assert.strictEqual(entry.compressionMethod, CompressionMethod.Stored);
      });

      it("copies the flags", () => {
        const flags = new GeneralPurposeFlags(
          GeneralPurposeFlags.HasUtf8Strings |
            GeneralPurposeFlags.HasDataDescriptor,
        );
        const entry = new ZipEntry({ flags }, "hello");

        assert.strictEqual(entry.flags.value, flags.value);
        assert.notStrictEqual(entry.flags, flags);
      });
    });
  });

  describe("class ZipEntryReader", () => {
    describe("open()", () => {
      it("throws if the compression method is unknown", () => {
        const entry = new ZipEntryReader(
          new CentralDirectoryHeader({
            attributes: new DosFileAttributes(DosFileAttributes.System),
            comment: "the comment goes here",
            compressedSize: 11,
            compressionMethod: 10,
            crc32: 222957957,
            extraField: new ExtraFieldCollection(),
            flags: new GeneralPurposeFlags(GeneralPurposeFlags.HasEncryption),
            lastModified: new Date(1747586332724),
            localHeaderOffset: 0x44332211,
            path: "here is the path",
            uncompressedSize: 0x88776655,
            versionMadeBy: ZipVersion.Utf8Encoding,
            versionNeeded: ZipVersion.Deflate,
          }),
          Buffer.from("hello world"),
        );
        assert.throws(
          () => entry.open(),
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "unknown compression method 10",
        );
      });

      it("throws if the compressed size is wrong", async () => {
        const header = new CentralDirectoryHeader({
          attributes: new DosFileAttributes(DosFileAttributes.System),
          comment: "the comment goes here",
          compressedSize: 13,
          compressionMethod: CompressionMethod.Stored,
          crc32: 222957957,
          extraField: new ExtraFieldCollection(),
          flags: new GeneralPurposeFlags(GeneralPurposeFlags.HasEncryption),
          lastModified: new Date(1747586332724),
          localHeaderOffset: 0x44332211,
          path: "here is the path",
          uncompressedSize: 11,
          versionMadeBy: ZipVersion.Utf8Encoding,
          versionNeeded: ZipVersion.Deflate,
        });
        const entry = new ZipEntryReader(
          header,
          // needs to be a provider or the constructor will throw before we get
          // to open()
          () => Buffer.from("hello world"),
        );
        await assert.rejects(
          () => text(entry.open()),
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "entry compressed size mismatch",
        );
      });

      it("throws if the crc32 is wrong", async () => {
        const entry = new ZipEntryReader(
          new CentralDirectoryHeader({
            attributes: new DosFileAttributes(DosFileAttributes.System),
            comment: "the comment goes here",
            compressedSize: 11,
            compressionMethod: CompressionMethod.Stored,
            crc32: 11,
            extraField: new ExtraFieldCollection(),
            flags: new GeneralPurposeFlags(GeneralPurposeFlags.HasEncryption),
            lastModified: new Date(1747586332724),
            localHeaderOffset: 0x44332211,
            path: "here is the path",
            uncompressedSize: 11,
            versionMadeBy: ZipVersion.Utf8Encoding,
            versionNeeded: ZipVersion.Deflate,
          }),
          Buffer.from("hello world"),
        );
        await assert.rejects(
          () => text(entry.open()),
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "CRC-32 mismatch",
        );
      });

      it("throws if the uncompressed size is wrong", async () => {
        const entry = new ZipEntryReader(
          new CentralDirectoryHeader({
            attributes: new DosFileAttributes(DosFileAttributes.System),
            comment: "the comment goes here",
            compressedSize: 11,
            compressionMethod: CompressionMethod.Stored,
            crc32: 222957957,
            extraField: new ExtraFieldCollection(),
            flags: new GeneralPurposeFlags(GeneralPurposeFlags.HasEncryption),
            lastModified: new Date(1747586332724),
            localHeaderOffset: 0x44332211,
            path: "here is the path",
            uncompressedSize: 5,
            versionMadeBy: ZipVersion.Utf8Encoding,
            versionNeeded: ZipVersion.Deflate,
          }),
          Buffer.from("hello world"),
        );
        await assert.rejects(
          () => text(entry.open()),
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "entry uncompressed size mismatch",
        );
      });
    });

    describe("openCompressed()", () => {
      it("returns the compressed data", async () => {
        const entry = new ZipEntryReader(
          new CentralDirectoryHeader({
            attributes: new DosFileAttributes(DosFileAttributes.System),
            comment: "the comment goes here",
            compressedSize: 16,
            compressionMethod: 123,
            crc32: 11,
            extraField: new ExtraFieldCollection(),
            flags: new GeneralPurposeFlags(GeneralPurposeFlags.HasEncryption),
            lastModified: new Date(1747586332724),
            localHeaderOffset: 0x44332211,
            path: "here is the path",
            uncompressedSize: 11,
            versionMadeBy: ZipVersion.Utf8Encoding,
            versionNeeded: ZipVersion.Deflate,
          }),
          Buffer.from("still compressed"),
        );

        const data = await text(entry.openCompressed());
        assert.strictEqual(data, "still compressed");
      });
    });
  });

  describe("function minimumVersion()", () => {
    it("returns the correct version for features", () => {
      assert.strictEqual(minimumVersion({}), ZipVersion.Deflate);

      assert.strictEqual(
        minimumVersion({ utf8: true }),
        ZipVersion.Utf8Encoding,
      );

      assert.strictEqual(minimumVersion({ zip64: true }), ZipVersion.Zip64);

      assert.strictEqual(
        minimumVersion({ utf8: true, zip64: true }),
        ZipVersion.Utf8Encoding,
      );
    });

    it("returns the given version if it greater", () => {
      assert.strictEqual(
        minimumVersion({}, ZipVersion.Zip64),
        ZipVersion.Zip64,
      );

      assert.strictEqual(
        minimumVersion({ utf8: true }, ZipVersion.Utf8Encoding + 1),
        ZipVersion.Utf8Encoding + 1,
      );

      assert.strictEqual(
        minimumVersion({ zip64: true }, ZipVersion.Utf8Encoding),
        ZipVersion.Utf8Encoding,
      );

      assert.strictEqual(
        minimumVersion(
          { utf8: true, zip64: true },
          ZipVersion.Utf8Encoding + 1,
        ),
        ZipVersion.Utf8Encoding + 1,
      );
    });

    it("throws if the requested version is too low", () => {
      assert.throws(
        () => minimumVersion({ utf8: true }, ZipVersion.Zip64),
        (error) =>
          error instanceof Error &&
          error.message ===
            "versionMadeBy is explicitly set but is lower than the required value",
      );

      assert.throws(
        () => minimumVersion({ zip64: true }, ZipVersion.Deflate),
        (error) =>
          error instanceof Error &&
          error.message ===
            "versionMadeBy is explicitly set but is lower than the required value",
      );
    });
  });

  describe("function needs64bit()", () => {
    it("returns false if all values fit in 32bit", () => {
      const result = needs64bit({
        compressedSize: 0xffff_ffff,
        uncompressedSize: 0xffff_ffff,
        localHeaderOffset: 0xffff_ffff,
      });

      assert.strictEqual(result, false);
    });

    it("returns false if no values are supplied", () => {
      const result = needs64bit({});

      assert.strictEqual(result, false);
    });

    it("returns true if any value doesn't fit in 32bit", () => {
      const result1 = needs64bit({
        compressedSize: 0x1_0000_0000,
        uncompressedSize: 0xffff_ffff,
        localHeaderOffset: 0xffff_ffff,
      });

      assert.strictEqual(result1, true);

      const result2 = needs64bit({
        compressedSize: 0xffff_ffff,
        uncompressedSize: 0x1_0000_0000,
        localHeaderOffset: 0xffff_ffff,
      });

      assert.strictEqual(result2, true);

      const result3 = needs64bit({
        compressedSize: 0xffff_ffff,
        uncompressedSize: 0xffff_ffff,
        localHeaderOffset: 0x1_0000_0000,
      });

      assert.strictEqual(result3, true);

      const result4 = needs64bit({
        compressedSize: 0x1_0000_0000,
      });

      assert.strictEqual(result4, true);

      const result5 = needs64bit({
        uncompressedSize: 0x1_0000_0000,
      });

      assert.strictEqual(result5, true);

      const result6 = needs64bit({
        localHeaderOffset: 0x1_0000_0000,
      });

      assert.strictEqual(result6, true);
    });

    it("returns true if zip64 is true", () => {
      const result = needs64bit({
        compressedSize: 0xffff_ffff,
        uncompressedSize: 0xffff_ffff,
        localHeaderOffset: 0xffff_ffff,
        zip64: true,
      });

      assert.strictEqual(result, true);
    });

    it("returns true if there is a zip64 extra field", () => {
      const result = needs64bit({
        compressedSize: 0xffff_ffff,
        uncompressedSize: 0xffff_ffff,
        localHeaderOffset: 0xffff_ffff,
        extraField: new ExtraFieldCollection([new Zip64ExtraField([1, 2, 3])]),
      });

      assert.strictEqual(result, true);
    });

    it("throws if zip64 is false and the values don't fit in 32 bit", () => {
      assert.throws(
        () =>
          needs64bit({
            compressedSize: 0xffff_ffff,
            uncompressedSize: 0x1_0000_0000,
            localHeaderOffset: 0xffff_ffff,
            zip64: false,
          }),
        (error) =>
          error instanceof Error &&
          error.message ===
            "zip64 is explicitly false but the entry sizes are bigger than 32 bit",
      );
    });
  });

  describe("function needsDataDescriptor()", () => {
    it("returns false if all values are provided", () => {
      const result = needsDataDescriptor({
        compressedSize: 0,
        crc32: 0,
        uncompressedSize: 0,
      });

      assert.strictEqual(result, false);
    });

    it("returns true if any value isn't provided", () => {
      const result1 = needsDataDescriptor({
        crc32: 0,
        uncompressedSize: 0,
      });

      assert.strictEqual(result1, true);

      const result2 = needsDataDescriptor({
        compressedSize: 0,
        uncompressedSize: 0,
      });

      assert.strictEqual(result2, true);

      const result3 = needsDataDescriptor({
        compressedSize: 0,
        crc32: 0,
      });

      assert.strictEqual(result3, true);
    });
  });

  describe("function needsUtf8()", () => {
    it("returns false if values are cp437 encodable", () => {
      const result = needsUtf8({
        comment: "hello",
        path: "world",
      });

      assert.strictEqual(result, false);
    });

    it("returns true if values are not cp437 encodable", () => {
      const result1 = needsUtf8({
        comment: "👋",
        path: "world",
      });

      assert.strictEqual(result1, true);

      const result2 = needsUtf8({
        comment: "hello",
        path: "日",
      });

      assert.strictEqual(result2, true);
    });

    it("returns true if utf8 is true", () => {
      const result = needsUtf8({
        comment: "hello",
        path: "world",
        utf8: true,
      });

      assert.strictEqual(result, true);
    });

    it("throws if utf8 is false and values are not cp437 encodable", () => {
      assert.throws(
        () =>
          needsUtf8({
            comment: "hello",
            path: "日",
            utf8: false,
          }),
        (error) =>
          error instanceof Error &&
          error.message ===
            `utf8 is explicitly false but the path or comment requires utf8 encoding`,
      );
    });
  });
});
