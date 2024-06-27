import assert from "node:assert";
import { describe, it } from "node:test";
import { computeCrc32 } from "./crc32.js";

describe("computeCrc32", () => {
  it("returns 0 for zero-length input", () => {
    const input = new Uint8Array(0);
    const output = computeCrc32(input);
    assert.strictEqual(output, 0);
  });

  it("returns an unsigned value", () => {
    // value from here: https://github.com/SheetJS/js-crc32/issues/4
    const input = new Uint8Array([
      68, 69, 77, 79, 220, 187, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 68, 101, 109, 111,
      32, 83, 101, 115, 115, 105, 111, 110, 32, 32, 32, 32, 32, 32, 32, 32, 32,
      32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 158, 50, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 1, 1, 0, 0, 15, 102, 0, 0,
      72, 13, 0, 0, 69, 13, 0, 0, 77, 13, 0, 0, 65, 13, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ]);

    const output = computeCrc32(input);
    assert.strictEqual(output, 2795502179);
  });

  it("returns the correct CRC32 of a sub view", () => {
    // crc value from here: https://crccalc.com/
    const base = new Uint8Array([
      0xff, 0xff, 0xff, 0x12, 0x34, 0x56, 0x78, 0x90, 0xff, 0xff, 0xff,
    ]);
    const input = new Uint8Array(base.buffer, 3, 5);

    const output = computeCrc32(input);
    assert.strictEqual(output, 3700649649);
  });
});
