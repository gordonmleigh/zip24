import assert from "node:assert";
import { describe, it } from "node:test";
import { GeneralPurposeFlags } from "./field-types.js";

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
