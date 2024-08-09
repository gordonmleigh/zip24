import assert from "node:assert";
import { describe, it } from "node:test";
import { BitField, BufferView } from "./binary.js";

describe("util/binary", () => {
  describe("BufferView", () => {
    describe("alloc", () => {
      it("allocates a view with the given size", () => {
        assert.strictEqual(BufferView.alloc(10).byteLength, 10);
        assert.strictEqual(BufferView.alloc(42).byteLength, 42);
      });
    });

    describe("constructor", () => {
      it("creates an instance from an ArrayBuffer", () => {
        const arrayBuffer = new ArrayBuffer(10);
        const buffer = new BufferView(arrayBuffer);
        buffer.writeUint16LE(1, 0);
        buffer.writeUint16LE(2, 2);

        const words = new Uint16Array(arrayBuffer);
        assert.strictEqual(words[0], 1);
        assert.strictEqual(words[1], 2);
      });

      it("creates an instance from an ArrayBuffer with offset and length", () => {
        const arrayBuffer = new ArrayBuffer(10);
        const buffer = new BufferView(arrayBuffer, 2, 2);
        buffer.writeUint16LE(1, 0);

        assert.throws(() => {
          buffer.writeUint16LE(2, 2);
        });

        const words = new Uint16Array(arrayBuffer);
        assert.strictEqual(words[1], 1);
      });

      it("creates an instance from a Uint8Array", () => {
        const arrayBuffer = new ArrayBuffer(10);
        const array = new Uint8Array(arrayBuffer, 2, 4);
        const buffer = new BufferView(array, 2, 2);

        buffer.writeUint16LE(1, 0);

        assert.throws(() => {
          buffer.writeUint16LE(2, 2);
        });

        const words = new Uint16Array(arrayBuffer);
        assert.strictEqual(words[2], 1);
      });

      it("throws if the instance would overflow the source buffer", () => {
        const arrayBuffer = new ArrayBuffer(10);
        const array = new Uint8Array(arrayBuffer, 2, 4);

        assert.throws(() => {
          new BufferView(array, 0, 6);
        });

        assert.throws(() => {
          new BufferView(array, 2, 4);
        });

        assert.throws(() => {
          new BufferView(array, 5, 1);
        });
      });

      it("throws if the instance would overflow the source view", () => {
        const arrayBuffer = new ArrayBuffer(10);
        assert.throws(() => {
          new BufferView(arrayBuffer, 5, 10);
        });
      });
    });

    describe("getUint64()", () => {
      it("returns the correct value for little-endian", () => {
        const buffer = fromHex("11ccbc3ef999fe0000");
        assert.strictEqual(buffer.getUint64(1, true), 0xfe99f93ebccc);
      });

      it("returns the correct value for big-endian", () => {
        const buffer = fromHex("11001fffffffffffff");
        assert.strictEqual(buffer.getUint64(1, false), 0x1fffffffffffff);
      });

      it("throws if the read value isn't storable in Number", () => {
        const buffer = fromHex("ccbc3ef999feff00");
        assert.throws(() => buffer.getUint64(0));
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => buffer.getUint64(8));
      });
    });

    describe("readString", () => {
      it("can decode utf8", () => {
        const buffer = fromHex("616263f09f9982f09f9883f09f988178797a616263");
        const value = buffer.readString("utf8", 3, 15);
        assert.strictEqual(value, "🙂😃😁xyz");
      });

      it("can decode cp437", () => {
        const buffer = fromHex("6162630304050678797a616263");
        const value = buffer.readString("cp437", 3, 7);
        assert.strictEqual(value, "♥♦♣♠xyz");
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("616263616263");
        assert.throws(() => buffer.readString("utf8", 3, 15));
      });
    });

    describe("readUint8()", () => {
      it("returns the correct value", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.strictEqual(buffer.readUint8(0), 0xcc);
        assert.strictEqual(buffer.readUint8(3), 0xf9);
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => buffer.readUint8(8));
      });
    });

    describe("readUint16LE()", () => {
      it("returns the correct value", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.strictEqual(buffer.readUint16LE(0), 0xbccc);
        assert.strictEqual(buffer.readUint16LE(3), 0x99f9);
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => buffer.readUint16LE(8));
      });
    });

    describe("readUint32LE()", () => {
      it("returns the correct value", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.strictEqual(buffer.readUint32LE(0), 0xf93ebccc);
        assert.strictEqual(buffer.readUint32LE(3), 0xebfe99f9);
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => buffer.readUint32LE(8));
      });
    });

    describe("readUint64LE()", () => {
      it("returns the correct value", () => {
        const buffer = fromHex("ccbc3ef999fe0000");
        assert.strictEqual(buffer.readUint64LE(0), 0xfe99f93ebccc);
      });

      it("throws if the read value isn't storable in Number", () => {
        const buffer = fromHex("ccbc3ef999feff00");
        assert.throws(() => buffer.readUint64LE(0));
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => buffer.readUint64LE(8));
      });
    });

    describe("writeUint8", () => {
      it("sets bytes at the correct offset", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        buffer.writeUint8(0xbe, 0);
        buffer.writeUint8(0xef, 3);
        assert.strictEqual(toHex(buffer), "bebc3eef99feeb6f");
      });

      it("throws if the value is negative", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint8(-1, 0);
        });
      });

      it("throws if the value is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint8(0x100, 0);
        });
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => {
          buffer.writeUint8(0xff, 8);
        });
      });
    });

    describe("writeUint16LE", () => {
      it("sets bytes at the correct offset", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        buffer.writeUint16LE(0xadde, 0);
        buffer.writeUint16LE(0xefbe, 2);
        assert.strictEqual(toHex(buffer), "deadbeef99feeb6f");
      });

      it("throws if the value is negative", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint16LE(-1, 0);
        });
      });

      it("throws if the value is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint16LE(0x1_0000, 0);
        });
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => {
          buffer.writeUint16LE(0xff, 8);
        });
      });
    });

    describe("writeUint32LE", () => {
      it("sets bytes at the correct offset", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        buffer.writeUint32LE(0xefbeadde, 2);
        assert.strictEqual(toHex(buffer), "ccbcdeadbeefeb6f");
      });

      it("throws if the value is negative", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint32LE(-1, 0);
        });
      });

      it("throws if the value is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint32LE(0x1_0000_0000, 0);
        });
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => {
          buffer.writeUint32LE(0xff, 8);
        });
      });
    });

    describe("writeUint64LE", () => {
      it("sets bytes at the correct offset", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        buffer.writeUint64LE(0xefbeaddeadba, 2);
        assert.strictEqual(toHex(buffer), "ccbcbaaddeadbeef0000");
      });

      it("throws if the value is negative", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint64LE(-1, 0);
        });
      });

      it("throws if the value is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.writeUint64LE(Number.MAX_SAFE_INTEGER + 1, 0);
        });
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => {
          buffer.writeUint64LE(0xff, 8);
        });
      });
    });

    describe("setBytes", () => {
      it("sets the specified bytes", () => {
        const buffer = fromHex("ccbc3ef999fe0000");
        buffer.setBytes(3, fromHex("deadbeef").getOriginalBytes());
        assert.strictEqual(toHex(buffer), "ccbc3edeadbeef00");
      });

      it("throws if the data is out of bounds", () => {
        const buffer = fromHex("ccbc3ef999fe0000");
        assert.throws(() => {
          buffer.setBytes(5, fromHex("deadbeef").getOriginalBytes());
        });
      });
    });

    describe("setUint64", () => {
      it("sets little-endian bytes at the correct offset", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        buffer.setUint64(2, 0xefbeaddeadba, true);
        assert.strictEqual(toHex(buffer), "ccbcbaaddeadbeef0000");
      });

      it("throws if the value is negative", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.setUint64(0, -1);
        });
      });

      it("throws if the value is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f1111");
        assert.throws(() => {
          buffer.setUint64(0, Number.MAX_SAFE_INTEGER + 1);
        });
      });

      it("throws if the offset is too large", () => {
        const buffer = fromHex("ccbc3ef999feeb6f");
        assert.throws(() => {
          buffer.setUint64(8, 0xff);
        });
      });
    });
  });

  describe("BitField", () => {
    describe("constructor", () => {
      it("throws if width is not an integer", () => {
        assert.throws(() => {
          new BitField(1.234);
        });
      });
      it("throws if width is negative", () => {
        assert.throws(() => {
          new BitField(-1);
        });
      });
      it("throws if width is > 32", () => {
        assert.throws(() => {
          new BitField(33);
        });
      });

      it("throws if value is not an integer", () => {
        assert.throws(() => {
          new BitField(16, 1.234);
        });
      });
      it("throws if value is negative", () => {
        assert.throws(() => {
          new BitField(16, -1);
        });
      });
      it("throws if value is too large for the width", () => {
        assert.throws(() => {
          new BitField(16, 0x10000);
        });
        assert.throws(() => {
          new BitField(8, 0x100);
        });
      });

      it("accepts values valid for the width", () => {
        new BitField(32, 0xffffffff);
        new BitField(16, 0xffff);
        new BitField(16, 0x11ff);
        new BitField(8, 0xff);
      });
    });

    describe("value property", () => {
      it("throws if value is not an integer", () => {
        assert.throws(() => {
          new BitField(16).value = 1.234;
        });
      });
      it("throws if value is negative", () => {
        assert.throws(() => {
          new BitField(16).value = -1;
        });
      });
      it("throws if value is too large for the width", () => {
        assert.throws(() => {
          new BitField(16).value = 0x10000;
        });
        assert.throws(() => {
          new BitField(8).value = 0x100;
        });
      });
      it("sets the value", () => {
        const field = new BitField(16, 1234);
        field.value = 4321;
        assert.strictEqual(field.value, 4321);
      });
    });

    describe("getBit", () => {
      it("returns the correct value of the bit", () => {
        const field = new BitField(8, 0b10010110);
        assert.strictEqual(field.getBit(0), false);
        assert.strictEqual(field.getBit(1), true);
        assert.strictEqual(field.getBit(2), true);
        assert.strictEqual(field.getBit(3), false);
        assert.strictEqual(field.getBit(4), true);
        assert.strictEqual(field.getBit(5), false);
        assert.strictEqual(field.getBit(6), false);
        assert.strictEqual(field.getBit(7), true);
      });

      it("throws if bit is not an integer", () => {
        assert.throws(() => {
          new BitField(16).getBit(1.3);
        });
      });
      it("throws if bit is negative", () => {
        assert.throws(() => {
          new BitField(16).getBit(-1);
        });
      });
      it("throws if bit is greater than the width", () => {
        assert.throws(() => {
          new BitField(16).getBit(16);
        });
      });
    });

    describe("setBit", () => {
      it("sets the correct bit", () => {
        const field = new BitField(8, 0);

        field.setBit(0, true);
        assert.strictEqual(field.value, 0b00000001);
        field.setBit(1, true);
        assert.strictEqual(field.value, 0b00000011);
        field.setBit(2, true);
        assert.strictEqual(field.value, 0b00000111);
        field.setBit(3, true);
        assert.strictEqual(field.value, 0b00001111);
        field.setBit(6, true);
        assert.strictEqual(field.value, 0b01001111);
      });

      it("clears the correct bit", () => {
        const field = new BitField(8, 0xff);

        field.setBit(0, false);
        assert.strictEqual(field.value, 0b11111110);
        field.setBit(1, false);
        assert.strictEqual(field.value, 0b11111100);
        field.setBit(2, false);
        assert.strictEqual(field.value, 0b11111000);
        field.setBit(3, false);
        assert.strictEqual(field.value, 0b11110000);
        field.setBit(6, false);
        assert.strictEqual(field.value, 0b10110000);
      });

      it("throws if bit is not an integer", () => {
        assert.throws(() => {
          new BitField(16).setBit(1.3, false);
        });
      });
      it("throws if bit is negative", () => {
        assert.throws(() => {
          new BitField(16).setBit(-1, false);
        });
      });
      it("throws if bit is greater than the width", () => {
        assert.throws(() => {
          new BitField(16).setBit(16, false);
        });
      });
    });
  });
});

function fromHex(input: string): BufferView {
  return new BufferView(Buffer.from(input, "hex"));
}

function toHex(buffer: BufferView): string {
  return Buffer.from(buffer.getOriginalBytes()).toString("hex");
}
