import assert from "node:assert";
import { describe, it } from "node:test";
import {
  DosDate,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
} from "./field-types.js";

describe("DosFileAttributes", () => {
  describe("isReadOnly", () => {
    it("returns the correct value", () => {
      const value1 = new DosFileAttributes();
      assert.strictEqual(value1.isReadOnly, false);

      const value2 = new DosFileAttributes(1);
      assert.strictEqual(value2.isReadOnly, true);
    });

    it("sets the correct bit", () => {
      const value1 = new DosFileAttributes();
      value1.isReadOnly = true;
      assert.strictEqual(value1.value, 1);

      const value2 = new DosFileAttributes(0xff);
      value2.isReadOnly = false;
      assert.strictEqual(value2.value, 0xfe);
    });
  });

  describe("isHidden", () => {
    it("returns the correct value", () => {
      const value1 = new DosFileAttributes();
      assert.strictEqual(value1.isHidden, false);

      const value2 = new DosFileAttributes(0b10);
      assert.strictEqual(value2.isHidden, true);
    });

    it("sets the correct bit", () => {
      const value1 = new DosFileAttributes();
      value1.isHidden = true;
      assert.strictEqual(value1.value, 0b10);

      const value2 = new DosFileAttributes(0xff);
      value2.isHidden = false;
      assert.strictEqual(value2.value, 0xfd);
    });
  });

  describe("isSystem", () => {
    it("returns the correct value", () => {
      const value1 = new DosFileAttributes();
      assert.strictEqual(value1.isSystem, false);

      const value2 = new DosFileAttributes(0b100);
      assert.strictEqual(value2.isSystem, true);
    });

    it("sets the correct bit", () => {
      const value1 = new DosFileAttributes();
      value1.isSystem = true;
      assert.strictEqual(value1.value, 0b100);

      const value2 = new DosFileAttributes(0xff);
      value2.isSystem = false;
      assert.strictEqual(value2.value, 0xfb);
    });
  });

  describe("isDirectory", () => {
    it("returns the correct value", () => {
      const value1 = new DosFileAttributes();
      assert.strictEqual(value1.isDirectory, false);

      const value2 = new DosFileAttributes(0b10000);
      assert.strictEqual(value2.isDirectory, true);
    });

    it("sets the correct bit", () => {
      const value1 = new DosFileAttributes();
      value1.isDirectory = true;
      assert.strictEqual(value1.value, 0b10000);

      const value2 = new DosFileAttributes(0xff);
      value2.isDirectory = false;
      assert.strictEqual(value2.value, 0xef);
    });
  });

  describe("isFile", () => {
    it("returns the correct value", () => {
      const value1 = new DosFileAttributes();
      assert.strictEqual(value1.isFile, true);

      // directory
      const value2 = new DosFileAttributes(0b10000);
      assert.strictEqual(value2.isFile, false);
    });

    it("sets the correct bit", () => {
      // hidden, read-only directory
      const value1 = new DosFileAttributes(0b10011);
      value1.isFile = true;
      assert.strictEqual(value1.value, 0b00011);

      // system directory
      const value2 = new DosFileAttributes(0b10100);
      value2.isFile = true;
      assert.strictEqual(value2.value, 0b00100);
    });

    it("throws if isFile is set to false", () => {
      const value1 = new DosFileAttributes(0);
      assert.throws(
        () => (value1.isFile = false),
        (error) => error instanceof RangeError,
      );
    });
  });

  describe("rawValue", () => {
    it("returns the value", () => {
      const value1 = new DosFileAttributes(0b10011);
      assert.strictEqual(value1.rawValue, 0b10011);

      const value2 = new DosFileAttributes(0b10100);
      assert.strictEqual(value2.rawValue, 0b10100);
    });

    it("sets the value", () => {
      const value1 = new DosFileAttributes();
      value1.rawValue = 0b10011;
      assert.strictEqual(value1.value, 0b10011);

      const value2 = new DosFileAttributes();
      value2.rawValue = 0b10100;
      assert.strictEqual(value2.value, 0b10100);
    });
  });
});

describe("UnixFileAttributes", () => {
  describe("isDirectory", () => {
    it("returns the correct value", () => {
      const value1 = new UnixFileAttributes();
      assert.strictEqual(value1.isDirectory, false);

      const value2 = new UnixFileAttributes(0o4_0000);
      assert.strictEqual(value2.isDirectory, true);
    });

    it("sets the correct bits", () => {
      const value1 = new UnixFileAttributes();
      value1.isDirectory = true;
      assert.strictEqual(value1.value, 0o4_0000);

      const value2 = new UnixFileAttributes(0o4_7777);
      value2.isDirectory = false;
      // changes type to file
      assert.strictEqual(value2.value, 0o10_7777);
    });
  });

  describe("isFile", () => {
    it("returns the correct value", () => {
      const value1 = new UnixFileAttributes();
      assert.strictEqual(value1.isFile, false);

      const value2 = new UnixFileAttributes(0o10_0000);
      assert.strictEqual(value2.isFile, true);

      const value3 = new UnixFileAttributes(0o4_0000);
      assert.strictEqual(value3.isFile, false);
    });

    it("sets the correct bits", () => {
      const value1 = new UnixFileAttributes();
      value1.isFile = true;
      assert.strictEqual(value1.value, 0o10_0000);

      const value2 = new UnixFileAttributes(0o4_7777);
      value2.isFile = true;
      assert.strictEqual(value2.value, 0o10_7777);
    });

    it("throws if isFile is set to false", () => {
      const value1 = new UnixFileAttributes(0o10_0000);
      assert.throws(
        () => (value1.isFile = false),
        (error) => error instanceof RangeError,
      );
    });
  });

  describe("isReadOnly", () => {
    it("returns the correct value", () => {
      const value1 = new UnixFileAttributes(0o777);
      assert.strictEqual(value1.isReadOnly, false);

      const value2 = new UnixFileAttributes(0o444);
      assert.strictEqual(value2.isReadOnly, true);

      const value3 = new UnixFileAttributes(0o644);
      assert.strictEqual(value3.isReadOnly, false);
    });

    it("sets the correct bits", () => {
      const value1 = new UnixFileAttributes(0o777);
      value1.isReadOnly = true;
      assert.strictEqual(value1.permissions, 0o555);

      const value2 = new UnixFileAttributes(0o444);
      value2.isReadOnly = false;
      assert.strictEqual(value2.value, 0o666);
    });
  });

  describe("isSymbolicLink", () => {
    it("returns the correct value", () => {
      const value1 = new UnixFileAttributes();
      assert.strictEqual(value1.isSymbolicLink, false);

      const value2 = new UnixFileAttributes(0o12_0000);
      assert.strictEqual(value2.isSymbolicLink, true);
    });

    it("sets the correct bit", () => {
      const value1 = new UnixFileAttributes();
      value1.isSymbolicLink = true;
      assert.strictEqual(value1.value, 0o12_0000);

      const value2 = new UnixFileAttributes(0o12_7777);
      value2.isSymbolicLink = false;
      // changes type to file
      assert.strictEqual(value2.value, 0o10_7777);
    });
  });

  describe("mode", () => {
    it("returns only the mode", () => {
      const value1 = new UnixFileAttributes(0o12_1234);
      assert.strictEqual(value1.mode, 0o1234);

      const value2 = new UnixFileAttributes(0o17_4321);
      assert.strictEqual(value2.mode, 0o4321);
    });

    it("sets only the mode", () => {
      const value1 = new UnixFileAttributes(0o12_0000);
      value1.mode = 0o1234;
      assert.strictEqual(value1.value, 0o12_1234);

      const value2 = new UnixFileAttributes(0o17_0000);
      value2.mode = 0o4321;
      assert.strictEqual(value2.value, 0o17_4321);
    });
  });

  describe("permissions", () => {
    it("returns only the permissions", () => {
      const value1 = new UnixFileAttributes(0o121_234);
      assert.strictEqual(value1.permissions, 0o234);

      const value2 = new UnixFileAttributes(0o174_321);
      assert.strictEqual(value2.permissions, 0o321);
    });

    it("sets only the permissions", () => {
      const value1 = new UnixFileAttributes(0o120_000);
      value1.permissions = 0o234;
      assert.strictEqual(value1.value, 0o120_234);

      const value2 = new UnixFileAttributes(0o170_000);
      value2.permissions = 0o321;
      assert.strictEqual(value2.value, 0o170_321);
    });
  });

  describe("rawValue", () => {
    it("returns the value shifted to the upper word", () => {
      const value1 = new UnixFileAttributes(0xa29c);
      assert.strictEqual(value1.rawValue, 0xa29c0000);

      const value2 = new UnixFileAttributes(0xf8d1);
      assert.strictEqual(value2.rawValue, 0xf8d10000);
    });

    it("sets the value shifted to the lower word", () => {
      const value1 = new UnixFileAttributes();
      value1.rawValue = 0xa29c0000;
      assert.strictEqual(value1.value, 0xa29c);

      const value2 = new UnixFileAttributes();
      value2.rawValue = 0xf8d10000;
      assert.strictEqual(value2.value, 0xf8d1);
    });
  });

  describe("type", () => {
    it("returns only the type", () => {
      const value1 = new UnixFileAttributes(0o12_1234);
      assert.strictEqual(value1.type, 0o12_0000);

      const value2 = new UnixFileAttributes(0o17_4321);
      assert.strictEqual(value2.type, 0o17_0000);
    });

    it("sets only the type", () => {
      const value1 = new UnixFileAttributes(0o12_0000);
      value1.type = 0o13_4321;
      assert.strictEqual(value1.value, 0o13_0000);

      const value2 = new UnixFileAttributes(0o17_1234);
      value2.type = 0o12_0000;
      assert.strictEqual(value2.value, 0o12_1234);
    });
  });
});

describe("GeneralPurposeFlags", () => {
  describe("hasEncryption", () => {
    it("returns the correct value", () => {
      const value1 = new GeneralPurposeFlags();
      assert.strictEqual(value1.hasEncryption, false);

      const value2 = new GeneralPurposeFlags(1);
      assert.strictEqual(value2.hasEncryption, true);
    });
  });

  describe("hasDataDescriptor", () => {
    it("returns the correct value", () => {
      const value1 = new GeneralPurposeFlags();
      assert.strictEqual(value1.hasDataDescriptor, false);

      const value2 = new GeneralPurposeFlags(0b1000);
      assert.strictEqual(value2.hasDataDescriptor, true);
    });

    it("sets the correct bit", () => {
      const value1 = new GeneralPurposeFlags();
      value1.hasDataDescriptor = true;
      assert.strictEqual(value1.value, 0b1000);

      const value2 = new GeneralPurposeFlags(0xffff);
      value2.hasDataDescriptor = false;
      assert.strictEqual(value2.value, 0xfff7);
    });
  });

  describe("hasStrongEncryption", () => {
    it("returns the correct value", () => {
      const value1 = new GeneralPurposeFlags();
      assert.strictEqual(value1.hasStrongEncryption, false);

      const value2 = new GeneralPurposeFlags(0b1000000);
      assert.strictEqual(value2.hasStrongEncryption, true);
    });
  });

  describe("hasUtf8Strings", () => {
    it("returns the correct value", () => {
      const value1 = new GeneralPurposeFlags();
      assert.strictEqual(value1.hasUtf8Strings, false);

      const value2 = new GeneralPurposeFlags(0x800);
      assert.strictEqual(value2.hasUtf8Strings, true);
    });

    it("sets the correct bit", () => {
      const value1 = new GeneralPurposeFlags();
      value1.hasUtf8Strings = true;
      assert.strictEqual(value1.value, 0x800);

      const value2 = new GeneralPurposeFlags(0xffff);
      value2.hasUtf8Strings = false;
      assert.strictEqual(value2.value, 0xf7ff);
    });
  });
});

describe("DosDate", () => {
  describe("fromDosDateTime()", () => {
    it("sets the correct date and time", () => {
      const date = DosDate.fromDosDateTime(
        ((2024 - 1980) << 9) | (6 << 5) | 13,
        (20 << 11) | (56 << 5) | 5,
      );

      assert.strictEqual(
        date.toISOString(),
        new Date(2024, 6 - 1, 13, 20, 56, 10).toISOString(),
      );
    });
  });

  describe("fromDosUint32()", () => {
    it("sets the correct date and time", () => {
      const date = DosDate.fromDosUint32(
        ((2024 - 1980) << 25) |
          (6 << 21) |
          (13 << 16) |
          (20 << 11) |
          (56 << 5) |
          5,
      );

      assert.strictEqual(
        date.toISOString(),
        new Date(2024, 6 - 1, 13, 20, 56, 10).toISOString(),
      );
    });
  });

  describe("getDosDateTime()", () => {
    it("gets the correct timestamp value", () => {
      const date = new DosDate(2023, 5 - 1, 6, 10, 11, 20);

      assert.strictEqual(
        date.getDosDateTime(),
        ((2023 - 1980) << 25) |
          (5 << 21) |
          (6 << 16) |
          (10 << 11) |
          (11 << 5) |
          10,
      );
    });
  });
});
