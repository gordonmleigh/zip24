import assert from "node:assert";
import { describe, it } from "node:test";
import { DosDate } from "./dos-date.js";

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
