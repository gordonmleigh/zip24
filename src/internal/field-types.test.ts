import assert from "node:assert";
import { describe, it } from "node:test";
import { DosDate, GeneralPurposeFlags } from "./field-types.js";

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
