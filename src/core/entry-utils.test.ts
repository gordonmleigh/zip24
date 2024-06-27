import assert from "node:assert";
import { describe, it } from "node:test";
import { ZipVersion } from "./constants.js";
import {
  minimumVersion,
  needs64bit,
  needsDataDescriptor,
  needsUtf8,
} from "./entry-utils.js";

describe("entry-utils", () => {
  describe("minimumVersion", () => {
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

  describe("needs64bit", () => {
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

  describe("needsDataDescriptor", () => {
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

  describe("needsUtf8", () => {
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
