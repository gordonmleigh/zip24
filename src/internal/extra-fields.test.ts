import assert from "node:assert";
import { describe, it } from "node:test";
import { data, hex } from "../testing/data.js";
import { ZipFormatError, ZipSignatureError } from "./errors.js";
import {
  readExtraFields,
  readUnicodeExtraField,
  readZip64ExtraField,
  writeZip64ExtraField,
} from "./extra-fields.js";
import type { DecodedCentralHeader } from "./records.js";

describe.skip("readExtraFields()", () => {
  it("can read three fields together", () => {
    const entry: Partial<DecodedCentralHeader> = {
      comment: "hello",
      path: "world",
      compressedSize: 0xffff_ffff,
      uncompressedSize: 0xffff_ffff,
      localHeaderOffset: 0xffff_ffff,
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

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.comment, "ABC");
    assert.strictEqual(entry.path, "🥺");
    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
    assert.strictEqual(entry.localHeaderOffset, 0x010203010203);
  });

  it("can skip over unknown fields", () => {
    const entry: Partial<DecodedCentralHeader> = {
      compressedSize: 0xffff_ffff,
      uncompressedSize: 0xffff_ffff,
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

    readExtraFields(entry, buffer);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
  });

  it("can read from the middle of a buffer", () => {
    const entry: Partial<DecodedCentralHeader> = {
      compressedSize: 0xffff_ffff,
      uncompressedSize: 0xffff_ffff,
    };

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

describe("readUnicodeExtraField", () => {
  it("can read a unicode comment field", () => {
    const entry: Partial<DecodedCentralHeader> = {
      comment: "hello world",
    };

    const buffer = data(
      "7563", // tag: Info-ZIP Unicode Comment Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    readUnicodeExtraField(entry, buffer);

    assert.strictEqual(entry.comment, "ABC");
  });

  it("can read a unicode path field", () => {
    const entry: Partial<DecodedCentralHeader> = {
      path: "hello world",
    };

    const buffer = data(
      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    readUnicodeExtraField(entry, buffer);

    assert.strictEqual(entry.path, "ABC");
  });

  it("ignores unicode path field if the CRC32 does not match", () => {
    const entry: Partial<DecodedCentralHeader> = {
      path: "hello world",
    };

    const buffer = data(
      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "01020304", // random crc
      "414243", // data: ABC
    );

    readUnicodeExtraField(entry, buffer);

    assert.strictEqual(entry.path, "hello world");
  });

  it("ignores unicode comment field if the header comment is not set", () => {
    const entry: Partial<DecodedCentralHeader> = {
      comment: "",
    };

    const buffer = data(
      "7563", // tag: Info-ZIP Unicode Comment Extra Field
      "0800", // size: 8 bytes
      "01", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    readUnicodeExtraField(entry, buffer);

    assert.strictEqual(entry.comment, "");
  });

  it("throws if the tag is not valid", () => {
    const entry: Partial<DecodedCentralHeader> = {
      path: "hello world",
    };

    const buffer = data(
      "7571", // tag: bad tag
      "0800", // size: 8 bytes
      "02", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    assert.throws(
      () => {
        readUnicodeExtraField(entry, buffer);
      },
      (error) =>
        error instanceof ZipSignatureError &&
        error.message === "invalid signature for Info-ZIP unicode field (7175)",
    );
  });

  it("throws if the unicode path field version is not 1", () => {
    const entry: Partial<DecodedCentralHeader> = {
      path: "hello world",
    };

    const buffer = data(
      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0800", // size: 8 bytes
      "02", // version
      "85114a0d", // crc of "hello world"
      "414243", // data: ABC
    );

    assert.throws(
      () => {
        readUnicodeExtraField(entry, buffer);
      },
      (error) =>
        error instanceof ZipFormatError &&
        error.message === "expected version 1 of unicode field, got 2",
    );
  });
});

describe("readZip64ExtraField", () => {
  it("can read sizes from a Zip64 extended info field", () => {
    const entry: Partial<DecodedCentralHeader> = {
      compressedSize: 0xffff_ffff,
      uncompressedSize: 0xffff_ffff,
    };

    const buffer = data(
      "0100", // tag: Zip64 extended information extra field
      "1000", // size: 16 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size
    );

    readZip64ExtraField(entry, buffer);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
  });

  it("can read sizes and offset from a Zip64 extended info field", () => {
    const entry: Partial<DecodedCentralHeader> = {
      compressedSize: 0xffff_ffff,
      uncompressedSize: 0xffff_ffff,
      localHeaderOffset: 0xffff_ffff,
    };

    const buffer = data(
      "0100", // tag: Zip64 extended information extra field
      "1800", // size: 24 bytes
      "0102030405060000", // uncompressed size
      "0605040302010000", // compressed size
      "0302010302010000", // local header offset
    );

    readZip64ExtraField(entry, buffer);

    assert.strictEqual(entry.uncompressedSize, 0x060504030201);
    assert.strictEqual(entry.compressedSize, 0x010203040506);
    assert.strictEqual(entry.localHeaderOffset, 0x010203010203);
  });

  it("throws if value in Zip64 extended info field is too large for Number", () => {
    const entry: Partial<DecodedCentralHeader> = {
      compressedSize: 0xffff_ffff,
    };

    const buffer = data(
      "0100", // tag: Zip64 extended information extra field
      "0800", // size: 24 bytes
      "01020304050600ff", // compressed size
    );

    assert.throws(
      () => {
        readZip64ExtraField(entry, buffer);
      },
      // number loses precision so we use a regexp to match the error message
      (error) =>
        error instanceof RangeError &&
        /^\d+ is outside the range for 8 byte unsigned integer$/.test(
          error.message,
        ),
    );
  });

  it("throws if the tag is not valid", () => {
    assert.throws(
      () => {
        readZip64ExtraField(
          {},
          data(
            "0200", // tag
            "0000", // size
          ),
        );
      },
      (error) =>
        error instanceof ZipSignatureError &&
        error.message ===
          "invalid signature for Zip64 extended information extra field (2)",
    );
  });

  it("throws if the field isn't long enough", () => {
    assert.throws(
      () => {
        readZip64ExtraField(
          {
            uncompressedSize: 0xffff_ffff,
          },
          data(
            "0100", // tag: Zip64 extended information extra field
            "0000", // size
          ),
        );
      },
      (error) =>
        error instanceof ZipFormatError &&
        error.message === "Zip64 field not long enough",
    );

    assert.throws(
      () => {
        readZip64ExtraField(
          {
            uncompressedSize: 0xffff_ffff,
            compressedSize: 0xffff_ffff,
          },
          data(
            "0100", // tag: Zip64 extended information extra field
            "0800", // size
            "0102030405060000", // uncompressed size
          ),
        );
      },
      (error) =>
        error instanceof ZipFormatError &&
        error.message === "Zip64 field not long enough",
    );

    assert.throws(
      () => {
        readZip64ExtraField(
          {
            uncompressedSize: 0xffff_ffff,
            compressedSize: 0xffff_ffff,
            localHeaderOffset: 0xffff_ffff,
          },
          data(
            "0100", // tag: Zip64 extended information extra field
            "1000", // size
            "0102030405060000", // uncompressed size
            "0605040302010000", // compressed size
          ),
        );
      },
      (error) =>
        error instanceof ZipFormatError &&
        error.message === "Zip64 field not long enough",
    );
  });
});

describe("writeZip64ExtraField", () => {
  it("writes uncompressedSize and compressedSize", () => {
    const result = writeZip64ExtraField({
      uncompressedSize: 0xcba987654321,
      compressedSize: 0x123456789abc,
    });

    assert.strictEqual(
      hex(result),
      hex(
        "0100", // tag: Zip64 extended information extra field
        "1000", // size
        "21436587a9cb0000", // uncompressed size
        "bc9a785634120000", // compressed size
      ),
    );
  });

  it("writes uncompressedSize, compressedSize and localHeaderOffset", () => {
    const result = writeZip64ExtraField({
      uncompressedSize: 0xcba987654321,
      compressedSize: 0x123456789abc,
      localHeaderOffset: 0xffffffeeeeee,
    });

    assert.strictEqual(
      hex(result),
      hex(
        "0100", // tag: Zip64 extended information extra field
        "1800", // size
        "21436587a9cb0000", // uncompressed size
        "bc9a785634120000", // compressed size
        "eeeeeeffffff0000", // local header offset
      ),
    );
  });
});
