import assert from "node:assert";
import { describe, it } from "node:test";
import { BufferView } from "./binary.js";

describe("BufferView", () => {
  describe("readUint8()", () => {
    it("returns a uint8", () => {
      const buffer = new BufferView(Buffer.from("ccbc3ef999feeb6f", "hex"));

      assert.strictEqual(buffer.readUint8(0), 0xcc);
      assert.strictEqual(buffer.readUint8(3), 0xf9);
    });
  });

  describe("readUint16LE()", () => {
    it("returns a uint16 in little endian", () => {
      const buffer = new BufferView(Buffer.from("ccbc3ef999feeb6f", "hex"));

      assert.strictEqual(buffer.readUint16LE(0), 0xbccc);
      assert.strictEqual(buffer.readUint16LE(3), 0x99f9);
    });
  });

  describe("readUint32LE()", () => {
    it("returns a uint32 in little endian", () => {
      const buffer = new BufferView(Buffer.from("ccbc3ef999feeb6f", "hex"));

      assert.strictEqual(buffer.readUint32LE(0), 0xf93ebccc);
      assert.strictEqual(buffer.readUint32LE(3), 0xebfe99f9);
    });
  });

  describe("readUint64LE()", () => {
    it("returns a uint64 in little endian", () => {
      const buffer = new BufferView(Buffer.from("ccbc3ef999fe0000", "hex"));

      assert.strictEqual(buffer.readUint64LE(0), 0xfe99f93ebccc);
    });

    it("throws if the read value isn't storable in Number", () => {
      const buffer = new BufferView(Buffer.from("ccbc3ef999feff00", "hex"));

      assert.throws(() => buffer.readUint64LE(0));
    });
  });
});
