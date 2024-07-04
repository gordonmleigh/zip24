import assert from "node:assert";
import { describe, it } from "node:test";
import { assertBufferEqual } from "../test-util/assert.js";
import {
  bigUint,
  cp437,
  cp437length,
  data,
  longUint,
  shortUint,
  tinyUint,
} from "../test-util/data.js";
import { ZipPlatform, ZipVersion } from "./constants.js";
import { MultiDiskError, ZipFormatError, ZipSignatureError } from "./errors.js";
import { Eocdr, Zip64Eocdl, Zip64Eocdr, ZipTrailer } from "./zip-trailer.js";

describe("core/zip-trailer", () => {
  describe("class Eocdr", () => {
    describe(".deserialize()", () => {
      it("reads all the fields", () => {
        const buffer = data(
          longUint(0x06054b50), // signature (0x06054b50)
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(0x1234), // total entries this disk
          shortUint(0x1234), // total entries all disks
          longUint(0x78563412), // size of the central directory
          longUint(0x21436587), // central directory offset
          cp437length`hello world`, // .ZIP file comment length
          cp437`hello world`,
        );

        const record = Eocdr.deserialize(buffer);

        assert.strictEqual(record.comment, "hello world");
        assert.strictEqual(record.count, 0x1234);
        assert.strictEqual(record.offset, 0x21436587);
        assert.strictEqual(record.size, 0x78563412);
      });

      it("throws if the signature is invalid", () => {
        const buffer = data(
          longUint(0xffeeddcc), // signature (0x06054b50)
          shortUint(0), // number of this disk
          shortUint(1), // central directory start disk
          shortUint(0x1234), // total entries this disk
          shortUint(0x1234), // total entries all disks
          longUint(0x78563412), // size of the central directory
          longUint(0x21436587), // central directory offset
          cp437length`hello world`, // .ZIP file comment length
          cp437`hello world`,
        );

        assert.throws(
          () => Eocdr.deserialize(buffer),
          (error) =>
            error instanceof ZipSignatureError &&
            error.message ===
              "invalid signature for end of central directory record (ffeeddcc)",
        );
      });

      it("throws if there is more than one disk", () => {
        const buffer = data(
          longUint(0x06054b50), // signature (0x06054b50)
          shortUint(0), // number of this disk
          shortUint(1), // central directory start disk
          shortUint(0x1234), // total entries this disk
          shortUint(0x1234), // total entries all disks
          longUint(0x78563412), // size of the central directory
          longUint(0x21436587), // central directory offset
          cp437length`hello world`, // .ZIP file comment length
          cp437`hello world`,
        );

        assert.throws(
          () => Eocdr.deserialize(buffer),
          (error) => error instanceof MultiDiskError,
        );
      });

      it("reads all the fields when masked for Zip64", () => {
        const buffer = data(
          longUint(0x06054b50), // signature (0x06054b50)
          shortUint(0xffff), // number of this disk
          shortUint(0xffff), // central directory start disk
          shortUint(0xffff), // total entries this disk
          shortUint(0xffff), // total entries all disks
          longUint(0xffff_ffff), // size of the central directory
          longUint(0xffff_ffff), // central directory offset
          cp437length`hello world`, // .ZIP file comment length
          cp437`hello world`,
        );

        const record = Eocdr.deserialize(buffer);

        assert.strictEqual(record.comment, "hello world");
        assert.strictEqual(record.count, 0xffff);
        assert.strictEqual(record.offset, 0xffff_ffff);
        assert.strictEqual(record.size, 0xffff_ffff);
      });
    });

    describe(".find()", () => {
      it("finds the offset of the EOCDR", () => {
        const buffer = data(
          "c34b9b3fd8fab4e5083dfcf0ba51325e", // 16 bytes per line
          "e9a86b5b91a41ac3da6a439c794c9524",
          "891ce07d1b5b64cfab5d308ea6066991",

          longUint(0x06054b50), // signature (0x06054b50)
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(0x1234), // total entries this disk
          shortUint(0x1234), // total entries all disks
          longUint(0x78563412), // size of the central directory
          longUint(0x21436587), // central directory offset
          shortUint(32), // .ZIP file comment length
          "9f4fea5b5a32b27b7b127a8965591955",
          "13a34b026b9a69ff242a41699dcdac0f",
        );

        const offset = Eocdr.findOffset(buffer);

        assert.strictEqual(offset, 48);
      });

      it("throws if there is no EOCDR found", () => {
        const buffer = data(
          "c34b9b3fd8fab4e5083dfcf0ba51325e", // 16 bytes per line
          "e9a86b5b91a41ac3da6a439c794c9524",
          "891ce07d1b5b64cfab5d308ea6066991",
          "9f4fea5b5a32b27b7b127a8965591955",
          "13a34b026b9a69ff242a41699dcdac0f",
        );

        assert.throws(
          () => Eocdr.findOffset(buffer),
          (error) =>
            error instanceof ZipFormatError &&
            error.message === "unable to find end of central directory record",
        );
      });
    });

    describe("#serialize()", () => {
      it("writes all the values", () => {
        const record = new Eocdr({
          comment: "hello world",
          count: 0x1234,
          offset: 0x21436587,
          size: 0x78563412,
        });

        const expected = data(
          longUint(0x06054b50), // signature (0x06054b50)
          shortUint(0), // number of this disk
          shortUint(0), // central directory start disk
          shortUint(0x1234), // total entries this disk
          shortUint(0x1234), // total entries all disks
          longUint(0x78563412), // size of the central directory
          longUint(0x21436587), // central directory offset
          cp437length`hello world`, // .ZIP file comment length
          cp437`hello world`,
        );

        const result = record.serialize();

        assertBufferEqual(result, expected);
      });

      it("masks values if zip64 is set", () => {
        const record = new Eocdr(
          {
            comment: "hello world",
            count: 0x1234,
            offset: 0x21436587,
            size: 0x78563412,
          },
          true,
        );

        const expected = data(
          longUint(0x06054b50), // signature (0x06054b50)
          shortUint(0xffff), // number of this disk
          shortUint(0xffff), // central directory start disk
          shortUint(0xffff), // total entries this disk
          shortUint(0xffff), // total entries all disks
          longUint(0xffff_ffff), // size of the central directory
          longUint(0xffff_ffff), // central directory offset
          cp437length`hello world`, // .ZIP file comment length
          cp437`hello world`,
        );

        const result = record.serialize();

        assertBufferEqual(result, expected);
      });
    });
  });

  describe("class Zip64Eocdl", () => {
    describe(".deserialize()", () => {
      it("reads all the fields", () => {
        const buffer = data(
          longUint(0x07064b50), // EOCDL signature (0x07064b50)
          longUint(0), // start disk of Zip64 EOCDR
          bigUint(0x605040302010), // offset of Zip64 EOCDR
          longUint(1), // total number of disks
        );

        const record = Zip64Eocdl.deserialize(buffer);

        assert.strictEqual(record.eocdrOffset, 0x605040302010);
      });

      it("throws if the signature is invalid", () => {
        const buffer = data(
          "11223344", // signature (invalid)
          "00000000", // start disk of Zip64 EOCDR
          "20ff000000000000", // offset of Zip64 EOCDR
          "01000000", // total number of disks
        );

        assert.throws(
          () => Zip64Eocdl.deserialize(buffer),
          (error) =>
            error instanceof ZipSignatureError &&
            error.message === "invalid signature for Zip64 EOCDL (44332211)",
        );
      });

      it("throws if there are multiple disks", () => {
        const buffer = data(
          longUint(0x07064b50), // EOCDL signature (0x07064b50)
          longUint(0), // start disk of Zip64 EOCDR
          bigUint(0x605040302010), // offset of Zip64 EOCDR
          longUint(2), // total number of disks
        );

        assert.throws(
          () => Zip64Eocdl.deserialize(buffer),
          (error) => error instanceof MultiDiskError,
        );
      });
    });

    describe(".find()", () => {
      it("returns an instance if the EOCDL is present", () => {
        const buffer = data(
          longUint(0x07064b50), // EOCDL signature
          longUint(0), // start disk of Zip64 EOCDR
          bigUint(0x102030405060), // offset of Zip64 EOCDR
          longUint(1), // total number of disks

          longUint(0x06054b50), // EOCDR signature
          shortUint(0xffff), // number of this disk
          shortUint(0xffff), // central directory start disk
          shortUint(0xffff), // total entries this disk
          shortUint(0xffff), // total entries all disks
          longUint(0xffff_ffff), // size of the central directory
          longUint(0xffff_ffff), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        const result = Zip64Eocdl.find(buffer, 20);

        assert(result);
        assert.strictEqual(result.eocdrOffset, 0x102030405060);
      });

      it("returns undefined if the EOCDL is not present", () => {
        const buffer = data(
          "6d8d5cd7bdd763727d2745543e06b015", // 16 bytes per line
          "a6c3fc8555ac2f5f3545616cbeff003e",

          longUint(0x06054b50), // EOCDR signature
          shortUint(0xffff), // number of this disk
          shortUint(0xffff), // central directory start disk
          shortUint(0xffff), // total entries this disk
          shortUint(0xffff), // total entries all disks
          longUint(0xffff_ffff), // size of the central directory
          longUint(0xffff_ffff), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        const result = Zip64Eocdl.find(buffer, 32);

        assert.strictEqual(result, undefined);
      });

      it("returns undefined if the EOCDL would be outside the buffer", () => {
        const buffer = data(
          "6d8d5cd7bdd763727d2745543e06b015", // 16 bytes

          longUint(0x06054b50), // EOCDR signature
          shortUint(0xffff), // number of this disk
          shortUint(0xffff), // central directory start disk
          shortUint(0xffff), // total entries this disk
          shortUint(0xffff), // total entries all disks
          longUint(0xffff_ffff), // size of the central directory
          longUint(0xffff_ffff), // central directory offset
          cp437length`Gordon is cool`, // .ZIP file comment length
          cp437`Gordon is cool`, // .ZIP file comment
        );

        const result = Zip64Eocdl.find(buffer, 16);

        assert.strictEqual(result, undefined);
      });
    });

    describe("#serialize()", () => {
      it("writes all the fields", () => {
        const record = new Zip64Eocdl(0x123456789abc);
        const result = record.serialize();

        const expected = data(
          longUint(0x07064b50), // signature
          longUint(0), // start disk of Zip64 EOCDR
          bigUint(0x123456789abc), // offset of Zip64 EOCDR
          longUint(1), // total number of disks
        );

        assertBufferEqual(result, expected);
      });
    });
  });

  describe("class Zip64Eocdr", () => {
    describe(".deserialize()", () => {
      it("can read all the fields", () => {
        const buffer = data(
          longUint(0x06064b50), // EOCDR64 signature
          bigUint(56 - 12), // record size (SizeOfFixedFields + SizeOfVariableData - 12)
          tinyUint(ZipVersion.Utf8Encoding), // version made by
          tinyUint(ZipPlatform.DOS),
          shortUint(ZipVersion.Zip64), // version needed
          longUint(0), // number of this disk
          longUint(0), // central directory start disk
          bigUint(0x0123456789ab), // total entries this disk
          bigUint(0x0123456789ab), // total entries on all disks
          bigUint(0xabcdef010203), // size of the central directory
          bigUint(0x010203abcdef), // central directory offset
        );

        const eocdr = Zip64Eocdr.deserialize(buffer);

        assert.strictEqual(eocdr.versionMadeBy, ZipVersion.Utf8Encoding);
        assert.strictEqual(eocdr.platformMadeBy, ZipPlatform.DOS);
        assert.strictEqual(eocdr.versionNeeded, ZipVersion.Zip64);
        assert.strictEqual(eocdr.count, 0x0123456789ab);
        assert.strictEqual(eocdr.size, 0xabcdef010203);
        assert.strictEqual(eocdr.offset, 0x010203abcdef);
      });

      it("throws if the signature is invalid", () => {
        const buffer = data(
          longUint(0x10203040), // EOCDR64 signature
          bigUint(56 - 12), // record size (SizeOfFixedFields + SizeOfVariableData - 12)
          tinyUint(ZipVersion.Utf8Encoding), // version made by
          tinyUint(ZipPlatform.DOS),
          shortUint(ZipVersion.Zip64), // version needed
          longUint(0), // number of this disk
          longUint(0), // central directory start disk
          bigUint(0x0123456789ab), // total entries this disk
          bigUint(0x0123456789ab), // total entries on all disks
          bigUint(0xabcdef010203), // size of the central directory
          bigUint(0x010203abcdef), // central directory offset
        );

        assert.throws(
          () => Zip64Eocdr.deserialize(buffer),
          (error) =>
            error instanceof ZipSignatureError &&
            error.message === "invalid signature for Zip64 EOCDR (10203040)",
        );
      });
    });

    describe("#serialize()", () => {
      it("writes all the fields", () => {
        const eocdr = new Zip64Eocdr({
          count: 0x112233445566,
          offset: 0x665544332211,
          platformMadeBy: ZipPlatform.UNIX,
          size: 0x555544443333,
          versionMadeBy: ZipVersion.Zip64,
          versionNeeded: ZipVersion.Utf8Encoding,
        });

        const result = eocdr.serialize();

        const expected = data(
          longUint(0x06064b50), // EOCDR64 signature (0x06064b50)
          bigUint(56 - 12), // record size (SizeOfFixedFields + SizeOfVariableData - 12)
          tinyUint(ZipVersion.Zip64), // version made by
          tinyUint(ZipPlatform.UNIX), // platform made by
          shortUint(ZipVersion.Utf8Encoding), // version needed
          longUint(0), // number of this disk
          longUint(0), // central directory start disk
          bigUint(0x112233445566), // total entries this disk
          bigUint(0x112233445566), // total entries on all disks
          bigUint(0x555544443333), // size of the central directory
          bigUint(0x665544332211), // central directory offset
        );

        assertBufferEqual(result, expected);
      });
    });
  });

  describe("class ZipTrailer", () => {
    describe(".constructor()", () => {
      it("sets defaults when no arguments are passed", () => {
        const trailer = new ZipTrailer();
        assert.strictEqual(trailer.comment, "");
        assert.strictEqual(trailer.count, 0);
        assert.strictEqual(trailer.offset, 0);
        assert.strictEqual(trailer.size, 0);
        assert.strictEqual(trailer.zip64, undefined);
      });

      it("sets eocdr fields if provider", () => {
        const trailer = new ZipTrailer({
          comment: "the comment",
          count: 42,
          offset: 123,
          size: 96,
        });
        assert.strictEqual(trailer.comment, "the comment");
        assert.strictEqual(trailer.count, 42);
        assert.strictEqual(trailer.offset, 123);
        assert.strictEqual(trailer.size, 96);
        assert.strictEqual(trailer.zip64, undefined);
      });

      it("overrides the eocdr fields with eocdr64 fields if given", () => {
        const trailer = new ZipTrailer(
          {
            comment: "the comment",
            count: 42,
            offset: 123,
            size: 96,
          },
          {
            count: 142,
            offset: 1123,
            size: 196,
            platformMadeBy: ZipPlatform.UNIX,
            versionMadeBy: ZipVersion.Utf8Encoding,
            versionNeeded: ZipVersion.Zip64,
          },
        );
        assert.strictEqual(trailer.comment, "the comment");
        assert.strictEqual(trailer.count, 142);
        assert.strictEqual(trailer.offset, 1123);
        assert.strictEqual(trailer.size, 196);
        assert(trailer.zip64);
        assert.strictEqual(trailer.zip64.platformMadeBy, ZipPlatform.UNIX);
        assert.strictEqual(
          trailer.zip64.versionMadeBy,
          ZipVersion.Utf8Encoding,
        );
        assert.strictEqual(trailer.zip64.versionNeeded, ZipVersion.Zip64);
      });
    });
  });
});
