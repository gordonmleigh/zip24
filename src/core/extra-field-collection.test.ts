import assert from "node:assert";
import { describe, it } from "node:test";
import { assertBufferEqual, assertInstanceOf } from "../test-util/assert.js";
import {
  bigUint,
  data,
  longUint,
  shortUint,
  tinyUint,
  utf8,
} from "../test-util/data.js";
import { ExtraFieldTag } from "./constants.js";
import { ZipFormatError, ZipSignatureError } from "./errors.js";
import {
  ExtraFieldCollection,
  UnicodeExtraField,
  UnknownExtraField,
  Zip64ExtraField,
  type Zip64SizeFields,
} from "./extra-field-collection.js";

describe("internal/extra-field-collection", () => {
  describe("UnicodeExtraField", () => {
    describe(".deserialize()", () => {
      it("can read a unicode comment field", () => {
        const buffer = data(
          "abcdef",

          "7563", // tag: Info-ZIP Unicode Comment Extra Field
          "0800", // size: 8 bytes
          "01", // version
          "85114a0d", // crc of "hello world"
          "414243", // data: ABC
        );

        const field = UnicodeExtraField.deserialize(buffer, 3);

        assert.strictEqual(field.tag, 0x6375);
        assert.strictEqual(field.value, "ABC");
        assert.strictEqual(field.dataSize, 8);
        assert.strictEqual(field.crc32, 0x0d4a1185);
      });

      it("can read a unicode path field", () => {
        const buffer = data(
          "abcdef0123",

          "7570", // tag: Info-ZIP Unicode Path Extra Field
          shortUint(12 + 5), // size
          "01", // version
          "85114a0d", // crc of "hello world"
          utf8`path 1️⃣`, // data
        );

        const field = UnicodeExtraField.deserialize(buffer, 5);

        assert.strictEqual(field.tag, 0x7075);
        assert.strictEqual(field.value, "path 1️⃣");
        assert.strictEqual(field.dataSize, 12 + 5);
        assert.strictEqual(field.crc32, 0x0d4a1185);
      });

      it("throws if the tag is not valid", () => {
        const buffer = data(
          "7571", // tag: bad tag
          "0800", // size: 8 bytes
          "02", // version
          "85114a0d", // crc of "hello world"
          "414243", // data: ABC
        );

        assert.throws(
          () => {
            UnicodeExtraField.deserialize(buffer);
          },
          (error) =>
            error instanceof ZipSignatureError &&
            error.message ===
              "invalid signature for Info-ZIP unicode field (7175)",
        );
      });

      it("throws if the unicode path field version is not 1", () => {
        const buffer = data(
          "7570", // tag: Info-ZIP Unicode Path Extra Field
          "0800", // size: 8 bytes
          "02", // version
          "85114a0d", // crc of "hello world"
          "414243", // data: ABC
        );

        assert.throws(
          () => {
            UnicodeExtraField.deserialize(buffer);
          },
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "expected version 1 of unicode field, got 2",
        );
      });
    });

    describe("#serialize()", () => {
      it("writes the correct data", () => {
        const field = new UnicodeExtraField(
          ExtraFieldTag.UnicodeCommentField,
          0x12345678,
          "comment 🙂",
        );

        const buffer = field.serialize();

        assertBufferEqual(
          buffer,
          data(
            "7563", // tag: Info-ZIP Unicode Comment Extra Field
            shortUint(12 + 5), // size
            tinyUint(1), // version
            longUint(0x12345678), // crc
            utf8`comment 🙂`, // data
          ),
        );
      });
    });

    describe("#value", () => {
      it("can round-trip the value", () => {
        const field = new UnicodeExtraField(
          ExtraFieldTag.UnicodeCommentField,
          0x12345678,
          "hello",
        );
        assert.strictEqual(field.value, "hello");

        field.value = "world";
        assert.strictEqual(field.value, "world");
      });
    });
  });

  describe("UnknownExtraField", () => {
    describe(".deserialize()", () => {
      it("can deserialize a field", () => {
        const buffer = data(
          "abcdef",

          "efcd", // tag: Info-ZIP Unicode Comment Extra Field
          shortUint(10), // size: 8 bytes
          "0102030405060708090a",
        );

        const field = UnknownExtraField.deserialize(buffer, 3);

        assert.strictEqual(field.tag, 0xcdef);
        assert.strictEqual(field.dataSize, 10);

        assertBufferEqual(field.data, data("0102030405060708090a"));
      });
    });

    describe("#serialize()", () => {
      const field = new UnknownExtraField(0x1234, data("0504030201"));

      const buffer = field.serialize();

      assertBufferEqual(
        buffer,
        data(
          shortUint(0x1234), // tag
          shortUint(5), // data size
          "0504030201", // data
        ),
      );
    });
  });

  describe("Zip64ExtraField", () => {
    describe(".deserialize()", () => {
      it("can read two values from a Zip64 extended info field", () => {
        const buffer = data(
          "0100", // tag: Zip64 extended information extra field
          "1000", // size: 16 bytes
          "0102030405060000", // uncompressed size
          "0605040302010000", // compressed size
        );

        const field = Zip64ExtraField.deserialize(buffer);

        assert.deepStrictEqual(field.values, [0x060504030201, 0x010203040506]);
      });

      it("can read three values from a Zip64 extended info field", () => {
        const buffer = data(
          "0100", // tag: Zip64 extended information extra field
          "1800", // size: 24 bytes
          "0102030405060000", // uncompressed size
          "0605040302010000", // compressed size
          "0302010302010000", // local header offset
        );

        const field = Zip64ExtraField.deserialize(buffer);

        assert.deepStrictEqual(
          field.values,
          [0x060504030201, 0x010203040506, 0x010203010203],
        );
      });

      it("throws if value in Zip64 extended info field is too large for Number", () => {
        const buffer = data(
          "0100", // tag: Zip64 extended information extra field
          "0800", // size: 24 bytes
          "01020304050600ff", // compressed size
        );

        assert.throws(
          () => {
            Zip64ExtraField.deserialize(buffer);
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
            Zip64ExtraField.deserialize(
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
    });

    describe("#readFields()", () => {
      it("can read sizes from a Zip64 extended info field", () => {
        const entry: Zip64SizeFields = {
          compressedSize: 0xffff_ffff,
          uncompressedSize: 0xffff_ffff,
        };

        const field = new Zip64ExtraField([1, 2]);
        field.readFields(entry);

        assert.strictEqual(entry.uncompressedSize, 1);
        assert.strictEqual(entry.compressedSize, 2);
      });

      it("can read sizes and offset from a Zip64 extended info field", () => {
        const entry: Zip64SizeFields = {
          compressedSize: 0xffff_ffff,
          uncompressedSize: 0xffff_ffff,
          localHeaderOffset: 0xffff_ffff,
        };

        const field = new Zip64ExtraField([1, 2, 3]);
        field.readFields(entry);

        assert.strictEqual(entry.uncompressedSize, 1);
        assert.strictEqual(entry.compressedSize, 2);
        assert.strictEqual(entry.localHeaderOffset, 3);
      });

      it("throws if the field isn't long enough", () => {
        assert.throws(
          () => {
            new Zip64ExtraField().readFields({
              uncompressedSize: 0xffff_ffff,
            });
          },
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "Zip64 field not long enough",
        );

        assert.throws(
          () => {
            new Zip64ExtraField([1]).readFields({
              uncompressedSize: 0xffff_ffff,
              compressedSize: 0xffff_ffff,
            });
          },
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "Zip64 field not long enough",
        );

        assert.throws(
          () => {
            new Zip64ExtraField([1, 2]).readFields({
              uncompressedSize: 0xffff_ffff,
              compressedSize: 0xffff_ffff,
              localHeaderOffset: 0xffff_ffff,
            });
          },
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "Zip64 field not long enough",
        );
      });
    });

    describe("#serialize", () => {
      it("can serialize 2 values", () => {
        const field = new Zip64ExtraField([0x010203040506, 0x060504030201]);

        const buffer = field.serialize();

        assertBufferEqual(
          buffer,
          data(
            shortUint(1), // tag: Zip64 extended information extra field
            shortUint(16), // size
            bigUint(0x010203040506), // uncompressed size
            bigUint(0x060504030201), // compressed size
          ),
        );
      });

      it("can serialize 3 values", () => {
        const field = new Zip64ExtraField([
          0x010203040506, 0x060504030201, 0x010203060504,
        ]);

        const buffer = field.serialize();

        assertBufferEqual(
          buffer,
          data(
            shortUint(1), // tag: Zip64 extended information extra field
            shortUint(24), // size
            bigUint(0x010203040506), // uncompressed size
            bigUint(0x060504030201), // compressed size
            bigUint(0x010203060504), // local header offset
          ),
        );
      });
    });

    describe("#setValues()", () => {
      it("sets the fields in order", () => {
        const field = new Zip64ExtraField();

        field.setValues({
          uncompressedSize: 1,
          compressedSize: 2,
          localHeaderOffset: 3,
        });

        assert.deepStrictEqual(field.values, [1, 2, 3]);
      });

      it("overwrites the values with new values", () => {
        const field = new Zip64ExtraField([1, 2, 3]);

        field.setValues({
          uncompressedSize: 4,
          compressedSize: 5,
        });

        assert.deepStrictEqual(field.values, [4, 5]);
      });
    });
  });

  describe("ExtraFieldCollection", () => {
    describe(".deserialize", () => {
      it("can read four fields together", () => {
        const buffer = data(
          "7563", // tag: Info-ZIP Unicode Comment Extra Field
          "0800", // size: 8 bytes
          "01", // version
          "86a61036", // crc of "hello"
          "414243", // data: ABC

          "ff99", // nonsense
          "0a00", // ten more bytes of nonsense to come
          "0102030405060708090a", // nonsense

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

        const fields = ExtraFieldCollection.deserialize(buffer);

        const field0 = fields.fields[0];
        assertInstanceOf(field0, UnicodeExtraField);
        assert.strictEqual(field0.tag, ExtraFieldTag.UnicodeCommentField);
        assert.strictEqual(field0.dataSize, 8);
        assert.strictEqual(field0.crc32, 0x3610a686);
        assert.strictEqual(field0.value, "ABC");

        const field1 = fields.fields[1];
        assertInstanceOf(field1, UnknownExtraField);
        assert.strictEqual(field1.tag, 0x99ff);
        assertBufferEqual(field1.data, data("0102030405060708090a"));

        const field2 = fields.fields[2];
        assertInstanceOf(field2, UnicodeExtraField);
        assert.strictEqual(field2.tag, ExtraFieldTag.UnicodePathField);
        assert.strictEqual(field2.dataSize, 9);
        assert.strictEqual(field2.crc32, 0x3a771143);
        assert.strictEqual(field2.value, "🥺");

        const field3 = fields.fields[3];
        assertInstanceOf(field3, Zip64ExtraField);
        assert.strictEqual(field3.tag, ExtraFieldTag.Zip64ExtendedInfo);
        assert.strictEqual(field3.dataSize, 24);
        assert.deepStrictEqual(
          field3.values,
          [0x060504030201, 0x010203040506, 0x010203010203],
        );
      });
    });

    describe("#[Symbol.iterator]()", () => {
      it("iterates through the fields", () => {
        const fields = [
          new UnicodeExtraField(ExtraFieldTag.UnicodeCommentField, 0, "hello"),
          new UnicodeExtraField(ExtraFieldTag.UnicodePathField, 0, "world"),
          new UnknownExtraField(0x0102, data("010203")),
        ];

        const collection = new ExtraFieldCollection(fields);
        const iterator = collection[Symbol.iterator]();

        const result0 = iterator.next();
        assert(!result0.done);
        assert.strictEqual(result0.value, fields[0]);

        const result1 = iterator.next();
        assert(!result1.done);
        assert.strictEqual(result1.value, fields[1]);

        const result2 = iterator.next();
        assert(!result2.done);
        assert.strictEqual(result2.value, fields[2]);

        const result3 = iterator.next();
        assert.strictEqual(result3.done, true);
      });
    });

    describe("#getField()", () => {
      it("returns the field with the given tag", () => {
        const fields = new ExtraFieldCollection([
          new UnicodeExtraField(ExtraFieldTag.UnicodeCommentField, 0, "hello"),
          new UnicodeExtraField(ExtraFieldTag.UnicodePathField, 0, "world"),
          new UnknownExtraField(0x0102, data("010203")),
        ]);

        const path = fields.getField(ExtraFieldTag.UnicodePathField);
        assertInstanceOf(path, UnicodeExtraField);
        assert.strictEqual(path.value, "world");

        const unknown = fields.getField(0x0102);
        assertInstanceOf(unknown, UnknownExtraField);
      });

      it("returns undefined if the field is not present", () => {
        const fields = new ExtraFieldCollection([
          new UnicodeExtraField(ExtraFieldTag.UnicodeCommentField, 0, "hello"),
          new UnicodeExtraField(ExtraFieldTag.UnicodePathField, 0, "world"),
          new UnknownExtraField(0x0102, data("010203")),
        ]);

        const zip64 = fields.getField(ExtraFieldTag.Zip64ExtendedInfo);
        assert.strictEqual(zip64, undefined);
      });
    });

    describe("#serialize()", () => {
      it("serializes the fields properly", () => {
        const fields = new ExtraFieldCollection([
          new UnicodeExtraField(
            ExtraFieldTag.UnicodeCommentField,
            0x12345678,
            "hello",
          ),
          new UnicodeExtraField(
            ExtraFieldTag.UnicodePathField,
            0x87654321,
            "world",
          ),
          new UnknownExtraField(0x0102, data("010203")),
        ]);

        const buffer = fields.serialize();

        assertBufferEqual(
          buffer,
          data(
            shortUint(0x6375), // tag
            shortUint(10), // size
            tinyUint(1), // version
            longUint(0x12345678), // crc32
            utf8`hello`,

            shortUint(0x7075), // tag
            shortUint(10), // size
            tinyUint(1), // version
            longUint(0x87654321), // crc32
            utf8`world`,

            shortUint(0x0102), // tag
            shortUint(3), // size
            "010203", // data
          ),
        );
      });
    });
  });
});
