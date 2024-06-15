import assert from "node:assert";
import { describe, it } from "node:test";
import {
  ExtraFieldReader,
  type OverridableFileInfo,
} from "./extra-field-reader.js";
import { data } from "./test-utils/data.js";

describe("ExtraFieldReader", () => {
  describe("read()", () => {
    it("can read a unicode comment field", () => {
      const fields = { fileComment: "hello world" } as OverridableFileInfo;

      const buffer = data(
        "7563", // tag: Info-ZIP Unicode Comment Extra Field
        "0800", // size: 8 bytes
        "01", // version
        "85114a0d", // crc of "hello world"
        "414243", // data: ABC
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.fileComment, "ABC");
    });

    it("can read a unicode path field", () => {
      const fields = { fileName: "hello world" } as OverridableFileInfo;

      const buffer = data(
        "7570", // tag: Info-ZIP Unicode Path Extra Field
        "0800", // size: 8 bytes
        "01", // version
        "85114a0d", // crc of "hello world"
        "414243", // data: ABC
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.fileName, "ABC");
    });

    it("ignores unicode path field if the CRC32 does not match", () => {
      const fields = { fileName: "hello world" } as OverridableFileInfo;

      const buffer = data(
        "7570", // tag: Info-ZIP Unicode Path Extra Field
        "0800", // size: 8 bytes
        "01", // version
        "01020304", // random crc
        "414243", // data: ABC
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.fileName, "hello world");
    });

    it("ignores unicode comment field if the header comment is not set", () => {
      const fields = {} as OverridableFileInfo;

      const buffer = data(
        "7563", // tag: Info-ZIP Unicode Comment Extra Field
        "0800", // size: 8 bytes
        "01", // version
        "85114a0d", // crc of "hello world"
        "414243", // data: ABC
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.fileComment, undefined);
    });

    it("throws if the unicode path field version is not 1", () => {
      const fields = { fileName: "hello world" } as OverridableFileInfo;

      const buffer = data(
        "7570", // tag: Info-ZIP Unicode Path Extra Field
        "0800", // size: 8 bytes
        "02", // version
        "85114a0d", // crc of "hello world"
        "414243", // data: ABC
      );

      const reader = new ExtraFieldReader(fields);

      assert.throws(() => {
        reader.read(buffer);
      });
    });

    it("can read sizes from a Zip64 extended info field", () => {
      const fields: OverridableFileInfo = {
        fileName: "",
        compressedSize: 0xffffffff,
        uncompressedSize: 0xffffffff,
      };

      const buffer = data(
        "0100", // tag: Zip64 extended information extra field
        "1000", // size: 16 bytes
        "0102030405060000", // uncompressed size
        "0605040302010000", // compressed size
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.uncompressedSize, 0x060504030201);
      assert.strictEqual(fields.compressedSize, 0x010203040506);
    });

    it("can read sizes and offset from a Zip64 extended info field", () => {
      const fields: OverridableFileInfo = {
        fileName: "",
        compressedSize: 0xffffffff,
        uncompressedSize: 0xffffffff,
        localHeaderOffset: 0xffffffff,
      };

      const buffer = data(
        "0100", // tag: Zip64 extended information extra field
        "1800", // size: 24 bytes
        "0102030405060000", // uncompressed size
        "0605040302010000", // compressed size
        "0302010302010000", // local header offset
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.uncompressedSize, 0x060504030201);
      assert.strictEqual(fields.compressedSize, 0x010203040506);
      assert.strictEqual(fields.localHeaderOffset, 0x010203010203);
    });

    it("throws if value in Zip64 extended info field is too large for Number", () => {
      const fields: OverridableFileInfo = {
        fileName: "",
        compressedSize: 0xffffffff,
        uncompressedSize: 0,
      };

      const buffer = data(
        "0100", // tag: Zip64 extended information extra field
        "0800", // size: 24 bytes
        "01020304050600ff", // compressed size
      );

      const reader = new ExtraFieldReader(fields);

      assert.throws(
        () => {
          reader.read(buffer);
        },
        (error) => {
          assert(error instanceof RangeError);
          return true;
        },
      );
    });

    it("can read three fields together", () => {
      const fields: OverridableFileInfo = {
        fileComment: "hello",
        fileName: "world",
        compressedSize: 0xffffffff,
        uncompressedSize: 0xffffffff,
        localHeaderOffset: 0xffffffff,
      };

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

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.fileComment, "ABC");
      assert.strictEqual(fields.fileName, "🥺");
      assert.strictEqual(fields.uncompressedSize, 0x060504030201);
      assert.strictEqual(fields.compressedSize, 0x010203040506);
      assert.strictEqual(fields.localHeaderOffset, 0x010203010203);
    });

    it("can skip over unknown fields", () => {
      const fields: OverridableFileInfo = {
        fileName: "",
        compressedSize: 0xffffffff,
        uncompressedSize: 0xffffffff,
      };

      const buffer = data(
        "ff99", // nonsense
        "0a00", // ten more bytes of nonsense to come
        "0102030405060708090a", // nonsense

        "0100", // tag: Zip64 extended information extra field
        "1000", // size: 16 bytes
        "0102030405060000", // uncompressed size
        "0605040302010000", // compressed size
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer);

      assert.strictEqual(fields.uncompressedSize, 0x060504030201);
      assert.strictEqual(fields.compressedSize, 0x010203040506);
    });

    it("can read from the middle of a buffer", () => {
      const fields: OverridableFileInfo = {
        fileName: "",
        compressedSize: 0xffffffff,
        uncompressedSize: 0xffffffff,
      };

      const buffer = data(
        "0102030405060708090a", // nonsense

        "0100", // tag: Zip64 extended information extra field
        "1000", // size: 16 bytes
        "0102030405060000", // uncompressed size
        "0605040302010000", // compressed size

        "abcdef", // nonsense
      );

      const reader = new ExtraFieldReader(fields);
      reader.read(buffer, 10, 20);

      assert.strictEqual(fields.uncompressedSize, 0x060504030201);
      assert.strictEqual(fields.compressedSize, 0x010203040506);
    });
  });
});
