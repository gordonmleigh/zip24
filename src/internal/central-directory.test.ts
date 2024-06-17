import assert from "node:assert";
import { describe, it } from "node:test";
import {
  MultiDiskError,
  ZipFormatError,
  ZipSignatureError,
} from "../common.js";
import { readEocdr, type CentralDirectory } from "./central-directory.js";
import { cp437, data } from "./test-utils/data.js";

describe("readEocdr", () => {
  it("can read an EOCDR", () => {
    const buffer = data(
      "89273498892734988927349889273498",
      "89273498892734988927349889273498", // nonsense (32 bytes)
      "504b0506", // signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "1234", // total entries this disk
      "1234", // total entries all disks
      "12345678", // size of the central directory
      "87654321", // central directory offset
      "0e00", // .ZIP file comment length
      cp437`Gordon is cool`, // .ZIP file comment
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    const result = readEocdr(directory, buffer);
    assert(result.ok);

    assert.strictEqual(directory.comment, "Gordon is cool");
    assert.strictEqual(directory.count, 0x3412);
    assert.strictEqual(directory.offset, 0x21436587);
    assert.strictEqual(directory.size, 0x78563412);
  });

  it("can read an EOCDR64", () => {
    const buffer = data(
      "89273498892734988927349889273498",
      "89273498892734988927349889273498", // nonsense (32 bytes)

      "504b0606", // EOCDR64 signature (0x06064b50)
      "3800000000000000", // record size
      "2d00", // version made by
      "2d00", // version needed
      "00000000", // number of this disk
      "00000000", // central directory start disk
      "0123456789ab0000", // total entries this disk
      "0123456789ab0000", // total entries on all disks
      "abcdef0102030000", // size of the central directory
      "010203abcdef0000", // central directory offset

      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // central directory start disk
      "20ff000000000000", // central directory offset
      "01000000", // total number of disks

      "504b0506", // EOCDR signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "ffff", // total entries this disk
      "ffff", // total entries all disks
      "ffffffff", // size of the central directory
      "ffffffff", // central directory offset
      "0e00", // .ZIP file comment length
      cp437`Gordon is cool`, // .ZIP file comment
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    const result = readEocdr(directory, buffer, 0xff00);
    assert(result.ok);

    assert.strictEqual(directory.comment, "Gordon is cool");
    assert.strictEqual(directory.count, 0xab8967452301);
    assert.strictEqual(directory.offset, 0xefcdab030201);
    assert.strictEqual(directory.size, 0x030201efcdab);
  });

  it("returns the offset and length when the EOCDR64 is not in the buffer", () => {
    const buffer = data(
      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // central directory start disk
      "20ff000000000000", // central directory offset
      "01000000", // total number of disks

      "504b0506", // EOCDR signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "ffff", // total entries this disk
      "ffff", // total entries all disks
      "ffffffff", // size of the central directory
      "ffffffff", // central directory offset
      "0e00", // .ZIP file comment length
      cp437`Gordon is cool`, // .ZIP file comment
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    const result = readEocdr(directory, buffer, 0xffff);
    assert(!result.ok);
    assert.strictEqual(result.eocdr64Offset, 0xff20);
    assert.strictEqual(result.byteLength, 56);
  });

  it("throws if EOCDR has more than one disk", () => {
    const buffer = data(
      "89273498892734988927349889273498",
      "89273498892734988927349889273498", // nonsense (32 bytes)

      "504b0506", // EOCDR signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "1234", // total entries this disk
      "2134", // total entries all disks
      "ffffffff", // size of the central directory
      "ffffffff", // central directory offset
      "0e00", // .ZIP file comment length
      cp437`Gordon is cool`, // .ZIP file comment
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    assert.throws(
      () => readEocdr(directory, buffer, 0xffff),
      (error) => error instanceof MultiDiskError,
    );
  });

  it("throws if EOCDL has more than one disk", () => {
    const buffer = data(
      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // central directory start disk
      "20ff000000000000", // central directory offset
      "02000000", // total number of disks

      "504b0506", // EOCDR signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "ffff", // total entries this disk
      "ffff", // total entries all disks
      "ffffffff", // size of the central directory
      "ffffffff", // central directory offset
      "0e00", // .ZIP file comment length
      cp437`Gordon is cool`, // .ZIP file comment
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    assert.throws(
      () => readEocdr(directory, buffer, 0xffff),
      (error) => error instanceof MultiDiskError,
    );
  });

  it("throws if there is no EOCDR", () => {
    const buffer = data(
      "89273498892734988927349889273498",
      "89273498892734988927349889273498",
      "89273498892734988927349889273498",
      "89273498892734988927349889273498",
      "89273498892734988927349889273498",
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    assert.throws(
      () => readEocdr(directory, buffer, 0xffff),
      (error) => error instanceof ZipFormatError,
    );
  });

  it("throws if the EOCDR64 has a bad signature", () => {
    const buffer = data(
      "89273498892734988927349889273498",
      "89273498892734988927349889273498", // nonsense (32 bytes)

      "ffffffff", // EOCDR64 signature (0x06064b50)
      "3800000000000000", // record size
      "2d00", // version made by
      "2d00", // version needed
      "00000000", // number of this disk
      "00000000", // central directory start disk
      "0123456789ab0000", // total entries this disk
      "0123456789ab0000", // total entries on all disks
      "abcdef0102030000", // size of the central directory
      "010203abcdef0000", // central directory offset

      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // central directory start disk
      "20ff000000000000", // central directory offset
      "01000000", // total number of disks

      "504b0506", // EOCDR signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "ffff", // total entries this disk
      "ffff", // total entries all disks
      "ffffffff", // size of the central directory
      "ffffffff", // central directory offset
      "0000", // .ZIP file comment length
    );

    const directory: CentralDirectory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };

    assert.throws(
      () => readEocdr(directory, buffer, 0xff00),
      (error) => error instanceof ZipSignatureError,
    );
  });
});
