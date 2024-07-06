import assert from "node:assert";
import { text } from "node:stream/consumers";
import { describe, it } from "node:test";
import { asyncIterable } from "../test-util/data.js";
import { ZipVersion } from "./constants.js";
import { DosFileAttributes, UnixFileAttributes } from "./file-attributes.js";
import {
  ZipEntry,
  minimumVersion,
  needs64bit,
  needsDataDescriptor,
  needsUtf8,
} from "./zip-entry.js";

describe("core/zip-entry", () => {
  describe("class ZipEntry", () => {
    describe("#constructor()", () => {
      describe("when noValidateVersion is set", () => {
        it("sets whatever value is present for versionMadeBy", () => {
          const entry = new ZipEntry({
            noValidateVersion: true,
            versionMadeBy: ZipVersion.Deflate,
            zip64: true,
          });

          assert.strictEqual(entry.versionMadeBy, ZipVersion.Deflate);
        });

        it("defaults to Utf8Encoding for versionMadeBy", () => {
          const entry = new ZipEntry({
            noValidateVersion: true,
            zip64: true,
          });

          assert.strictEqual(entry.versionMadeBy, ZipVersion.Utf8Encoding);
        });
      });
    });

    describe("#isDirectory", () => {
      it("returns true if the entry is a unix directory", () => {
        const entry = new ZipEntry();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isDirectory, true);
      });

      it("returns false if the entry is a unix file", () => {
        const entry = new ZipEntry();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isDirectory, false);
      });

      it("returns true if the entry is a dos directory", () => {
        const entry = new ZipEntry();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isDirectory, true);
      });

      it("returns false if the entry is a dos file", () => {
        const entry = new ZipEntry();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isDirectory, false);
      });

      it("returns true if the entry path ends with a slash", () => {
        const entry = new ZipEntry();
        entry.path = "directory/";

        assert.strictEqual(entry.isDirectory, true);
      });
    });

    describe("#isFile", () => {
      it("returns false if the entry is a unix directory", () => {
        const entry = new ZipEntry();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isFile, false);
      });

      it("returns true if the entry is a unix file", () => {
        const entry = new ZipEntry();
        entry.attributes = new UnixFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isFile, true);
      });

      it("returns false if the entry is a dos directory", () => {
        const entry = new ZipEntry();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isDirectory = true;

        assert.strictEqual(entry.isFile, false);
      });

      it("returns true if the entry is a dos file", () => {
        const entry = new ZipEntry();
        entry.attributes = new DosFileAttributes();
        entry.attributes.isFile = true;

        assert.strictEqual(entry.isFile, true);
      });

      it("returns false if the entry path ends with a slash", () => {
        const entry = new ZipEntry();
        entry.path = "directory/";

        assert.strictEqual(entry.isFile, false);
      });
    });

    describe("toBuffer()", () => {
      it("returns a UInt8Array for the uncompressedData", async () => {
        const entry = new ZipEntry();
        entry.uncompressedData = asyncIterable`Hallo, Welt!`;

        const buffer = await entry.toBuffer();

        const result = Buffer.from(buffer).toString();
        assert.strictEqual(result, "Hallo, Welt!");
      });
    });

    describe("toReadableStream()", () => {
      it("returns a ReadableStream for the uncompressedData", async () => {
        const entry = new ZipEntry();
        entry.uncompressedData = asyncIterable`Bonjour le monde !`;

        const readableStream = entry.toReadableStream();
        assert(readableStream instanceof ReadableStream);

        const result = await text(readableStream);
        assert.strictEqual(result, "Bonjour le monde !");
      });
    });

    describe("toText()", () => {
      it("returns a decoded string for the uncompressedData", async () => {
        const entry = new ZipEntry();
        entry.uncompressedData = asyncIterable`¡Hola Mundo! 🥺`;

        const result = await entry.toText();
        assert.strictEqual(result, "¡Hola Mundo! 🥺");
      });
    });

    describe("[Symbol.asyncIterator]()", () => {
      it("returns an iterator for the uncompressedData", async () => {
        const entry = new ZipEntry();
        entry.uncompressedData = asyncIterable`one ${1} two ${2}`;

        const iterator = entry[Symbol.asyncIterator]();

        const result1 = await iterator.next();
        assert(!result1.done);
        assert.strictEqual(result1.value.toString(), "one ");

        const result2 = await iterator.next();
        assert(!result2.done);
        assert.strictEqual(result2.value.toString(), "1");

        const result3 = await iterator.next();
        assert(!result3.done);
        assert.strictEqual(result3.value.toString(), " two ");

        const result4 = await iterator.next();
        assert(!result4.done);
        assert.strictEqual(result4.value.toString(), "2");

        const result5 = await iterator.next();
        assert.strictEqual(result5.done, true);
        assert.strictEqual(result5.value, undefined);
      });
    });
  });

  describe("minimumVersion()", () => {
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

  describe("needs64bit()", () => {
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

  describe("needsDataDescriptor()", () => {
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

  describe("needsUtf8()", () => {
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
