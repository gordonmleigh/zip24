import assert from "node:assert";
import { describe, it } from "node:test";
import { assertBufferEqual } from "../testing/assert.js";
import {
  bigUint,
  cp437,
  data,
  longUint,
  shortUint,
  tinyUint,
} from "../testing/data.js";
import {
  readEocdl,
  readEocdr,
  readZipTrailer,
  writeEocdl,
  writeEocdr,
  writeZip64Eocdr,
  writeZipTrailer,
} from "./central-directory.js";
import { MultiDiskError, ZipFormatError, ZipSignatureError } from "./errors.js";
import { ZipPlatform, ZipVersion } from "./field-types.js";
import type { CentralDirectory, CentralDirectory64 } from "./records.js";

describe("readZipTrailer", () => {
  it("can read an EOCDR", () => {
    const buffer = data(
      "504b0506", // signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "1234", // total entries this disk
      "1234", // total entries all disks
      "12345678", // size of the central directory
      "87654321", // central directory offset
      "0000", // .ZIP file comment length
    );

    const result = readZipTrailer(buffer);
    assert(result.ok);

    const directory = result.directory;
    assert.strictEqual(directory.comment, "");
    assert.strictEqual(directory.count, 0x3412);
    assert.strictEqual(directory.offset, 0x21436587);
    assert.strictEqual(directory.size, 0x78563412);
  });

  it("throws if the buffer isn't big enough to determine the file format", () => {
    const buffer = data(
      "504b0506", // signature (0x06054b50)
      "0000", // number of this disk
      "0000", // central directory start disk
      "1234", // total entries this disk
      "1234", // total entries all disks
      "12345678", // size of the central directory
      "87654321", // central directory offset
      "0000", // .ZIP file comment length
    );

    assert.throws(
      // read at fileOffset 20, which is big enough to potentially hold a EOCDL
      () => readZipTrailer(buffer, 20),
      (error) =>
        error instanceof Error &&
        error.message ===
          "buffer must be at least as big as the EOCDR and possible EOCDL",
    );
  });

  it("can read an EOCDR with a comment", () => {
    const buffer = data(
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

    const result = readZipTrailer(buffer);
    assert(result.ok);

    const directory = result.directory;
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
      "2c00000000000000", // record size (SizeOfFixedFields + SizeOfVariableData - 12)
      "2d00", // version made by
      "2d00", // version needed
      "00000000", // number of this disk
      "00000000", // central directory start disk
      "0123456789ab0000", // total entries this disk
      "0123456789ab0000", // total entries on all disks
      "abcdef0102030000", // size of the central directory
      "010203abcdef0000", // central directory offset

      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // start disk of Zip64 EOCDR
      "2000000001000000", // offset of Zip64 EOCDR
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

    const result = readZipTrailer(buffer, 0x1_0000_0000);
    assert(result.ok);

    const directory = result.directory;
    assert.strictEqual(directory.comment, "Gordon is cool");
    assert.strictEqual(directory.count, 0xab8967452301);
    assert.strictEqual(directory.offset, 0xefcdab030201);
    assert.strictEqual(directory.size, 0x030201efcdab);
  });

  it("returns the offset and length when the EOCDR64 is not in the buffer", () => {
    const buffer = data(
      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // start disk of Zip64 EOCDR
      "20ff000000000000", // offset of Zip64 EOCDR
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

    const result = readZipTrailer(buffer, 0xffff);
    assert(!result.ok);
    assert.strictEqual(result.eocdr64Offset, 0xff20);
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

    assert.throws(
      () => readZipTrailer(buffer, 0xffff),
      (error) => error instanceof MultiDiskError,
    );
  });

  it("throws if EOCDL has more than one disk", () => {
    const buffer = data(
      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // start disk of Zip64 EOCDR
      "20ff000000000000", // offset of Zip64 EOCDR
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

    assert.throws(
      () => readZipTrailer(buffer, 0xffff),
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

    assert.throws(
      () => readZipTrailer(buffer, 0xffff),
      (error) => error instanceof ZipFormatError,
    );
  });

  it("throws if the EOCDR64 has a bad signature", () => {
    const buffer = data(
      "89273498892734988927349889273498",
      "89273498892734988927349889273498", // nonsense (32 bytes)

      "ffffffff", // EOCDR64 signature (0x06064b50)
      "2c00000000000000", // record size (SizeOfFixedFields + SizeOfVariableData - 12)
      "2d00", // version made by
      "2d00", // version needed
      "00000000", // number of this disk
      "00000000", // central directory start disk
      "0123456789ab0000", // total entries this disk
      "0123456789ab0000", // total entries on all disks
      "abcdef0102030000", // size of the central directory
      "010203abcdef0000", // central directory offset

      "504b0607", // EOCDL signature (0x07064b50)
      "00000000", // start disk of Zip64 EOCDR
      "20ff000000000000", // offset of Zip64 EOCDR
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

    assert.throws(
      () => readZipTrailer(buffer, 0xff00),
      (error) => error instanceof ZipSignatureError,
    );
  });
});

describe("readEocdl", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      "11223344", // signature (invalid)
      "00000000", // start disk of Zip64 EOCDR
      "20ff000000000000", // offset of Zip64 EOCDR
      "01000000", // total number of disks
    );

    assert.throws(
      () => readEocdl(buffer),
      (error) =>
        error instanceof ZipSignatureError &&
        error.message === "invalid signature for Zip64 EOCDL (44332211)",
    );
  });
});

describe("readEocdr", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      "00887766", // signature (invalid)
      "0000", // number of this disk
      "0000", // central directory start disk
      "1234", // total entries this disk
      "1234", // total entries all disks
      "12345678", // size of the central directory
      "87654321", // central directory offset
      "0000", // .ZIP file comment length
    );

    assert.throws(
      () => readEocdr(buffer),
      (error) =>
        error instanceof ZipSignatureError &&
        error.message ===
          "invalid signature for end of central directory record (66778800)",
    );
  });
});

describe("writeEocdr", () => {
  it("writes all the basic fields", () => {
    const directory: CentralDirectory = {
      comment: "",
      count: 123,
      offset: 9087234,
      size: 237489,
    };

    const result = writeEocdr(directory);

    const expected = data(
      longUint(0x06054b50), // signature
      shortUint(0), // number of this disk
      shortUint(0), // central directory start disk
      shortUint(123), // total entries this disk
      shortUint(123), // total entries on all disks
      longUint(237489), // size of the central directory
      longUint(9087234), // central directory offset
      shortUint(0), // file comment length
    );

    assertBufferEqual(result, expected);
  });

  it("includes the comment if given", () => {
    const directory: CentralDirectory = {
      comment: "this is the file comment",
      count: 123,
      offset: 9087234,
      size: 237489,
    };

    const result = writeEocdr(directory);

    const expected = data(
      longUint(0x06054b50), // signature
      shortUint(0), // number of this disk
      shortUint(0), // central directory start disk
      shortUint(123), // total entries this disk
      shortUint(123), // total entries on all disks
      longUint(237489), // size of the central directory
      longUint(9087234), // central directory offset
      shortUint(24), // file comment length
      cp437`this is the file comment`,
    );

    assertBufferEqual(result, expected);
  });

  it("masks the sizes and offsets if zip64 is set", () => {
    const directory: CentralDirectory = {
      comment: "this is the file comment",
      count: 123,
      offset: 9087234,
      size: 237489,
      zip64: {
        platformMadeBy: ZipPlatform.DOS,
        versionMadeBy: ZipVersion.Zip64,
        versionNeeded: ZipVersion.Zip64,
      },
    };

    const result = writeEocdr(directory);

    const expected = data(
      longUint(0x06054b50), // signature
      shortUint(0xffff), // number of this disk
      shortUint(0xffff), // central directory start disk
      shortUint(0xffff), // total entries this disk
      shortUint(0xffff), // total entries on all disks
      longUint(0xffff_ffff), // size of the central directory
      longUint(0xffff_ffff), // central directory offset
      shortUint(24), // file comment length
      cp437`this is the file comment`,
    );

    assertBufferEqual(result, expected);
  });
});

describe("writeEocdl", () => {
  it("writes all the fields", () => {
    const result = writeEocdl(0x123456789abc);

    const expected = data(
      longUint(0x07064b50), // signature
      longUint(0), // start disk of Zip64 EOCDR
      bigUint(0x123456789abc), // offset of Zip64 EOCDR
      longUint(1), // total number of disks
    );

    assertBufferEqual(result, expected);
  });
});

describe("writeZip64Eocdr", () => {
  it("writes all the fields", () => {
    const directory: CentralDirectory64 = {
      comment: "this is the file comment",
      count: 0x112233445566,
      offset: 0x665544332211,
      size: 0x555544443333,
      zip64: {
        platformMadeBy: ZipPlatform.UNIX,
        versionMadeBy: ZipVersion.Zip64,
        versionNeeded: ZipVersion.Utf8Encoding,
      },
    };

    const result = writeZip64Eocdr(directory);

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

describe("writeZipTrailer", () => {
  it("can write a 32 bit trailer", () => {
    const directory: CentralDirectory = {
      comment: "this is the file comment",
      count: 123,
      offset: 9087234,
      size: 237489,
    };

    const result = writeZipTrailer(directory, 0x10000);

    const expected = data(
      longUint(0x06054b50), // signature
      shortUint(0), // number of this disk
      shortUint(0), // central directory start disk
      shortUint(123), // total entries this disk
      shortUint(123), // total entries on all disks
      longUint(237489), // size of the central directory
      longUint(9087234), // central directory offset
      shortUint(24), // file comment length
      cp437`this is the file comment`,
    );

    assertBufferEqual(result, expected);
  });

  it("can write a 64 bit trailer", () => {
    const directory: CentralDirectory64 = {
      comment: "this is the file comment",
      count: 0x112233445566,
      offset: 0x665544332211,
      size: 0x555544443333,
      zip64: {
        platformMadeBy: ZipPlatform.UNIX,
        versionMadeBy: ZipVersion.Zip64,
        versionNeeded: ZipVersion.Utf8Encoding,
      },
    };

    const result = writeZipTrailer(directory, 0x123456789abc);

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

      longUint(0x07064b50), // EOCDL signature
      longUint(0), // start disk of Zip64 EOCDR
      bigUint(0x123456789abc), // offset of Zip64 EOCDR
      longUint(1), // total number of disks

      longUint(0x06054b50), // signature
      shortUint(0xffff), // number of this disk
      shortUint(0xffff), // central directory start disk
      shortUint(0xffff), // total entries this disk
      shortUint(0xffff), // total entries on all disks
      longUint(0xffff_ffff), // size of the central directory
      longUint(0xffff_ffff), // central directory offset
      shortUint(24), // file comment length
      cp437`this is the file comment`,
    );

    assertBufferEqual(result, expected);
  });
});
