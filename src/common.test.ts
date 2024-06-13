import assert from "node:assert";
import { describe, it } from "node:test";
import { DosFileAttributes, UnixFileAttributes } from "./common.js";

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
});

describe("UnixFileAttributes", () => {
  describe("isDirectory", () => {
    it("returns the correct value", () => {
      const value1 = new UnixFileAttributes();
      assert.strictEqual(value1.isDirectory, false);

      const value2 = new UnixFileAttributes(0o4_0000);
      assert.strictEqual(value2.isDirectory, true);
    });

    it("sets the correct bit", () => {
      const value1 = new UnixFileAttributes();
      value1.isDirectory = true;
      assert.strictEqual(value1.value, 0o4_0000);

      const value2 = new UnixFileAttributes(0o4_7777);
      value2.isDirectory = false;
      // changes type to file
      assert.strictEqual(value2.value, 0o10_7777);
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
