import { assert } from "./assert.js";
import { CodePage437Decoder } from "./cp437.js";

function getUpperBound(bytes: number): number {
  switch (bytes) {
    case 1:
      return 0xff;

    case 2:
      return 0xffff;

    case 4:
      return 0xffffffff;

    case 8:
      return Number.MAX_SAFE_INTEGER;

    default:
      throw new TypeError(`expected bytes to be 1, 2, 4 or 8`);
  }
}

function assertBounds(value: number, bytes: number): void {
  assert(
    Number.isInteger(value) && value >= 0 && value <= getUpperBound(bytes),
    `${value} is outside the range for ${bytes} byte unsigned integer`,
  );
}

export type BufferLike = ArrayBuffer | ArrayBufferView;

export class BufferView extends DataView {
  public static alloc(byteLength: number): BufferView {
    return new BufferView(new ArrayBuffer(byteLength));
  }

  public constructor(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ) {
    if (ArrayBuffer.isView(buffer)) {
      super(buffer.buffer, buffer.byteOffset + (byteOffset ?? 0), byteLength);
    } else {
      super(buffer, byteOffset, byteLength);
    }
  }

  public getOriginalBytes(byteOffset = 0, byteLength?: number): Uint8Array {
    return new Uint8Array(
      this.buffer,
      this.byteOffset + byteOffset,
      byteLength,
    );
  }

  public copyBytes(
    sourceOffset = 0,
    byteLength = this.byteLength - sourceOffset,
    destination = new Uint8Array(byteLength),
    destinationOffset = 0,
  ): Uint8Array {
    destination.set(
      this.getOriginalBytes(sourceOffset, byteLength),
      destinationOffset,
    );
    return destination;
  }

  public setBytes(byteOffset: number, value: Uint8Array): void {
    this.getOriginalBytes(byteOffset, value.byteLength).set(value);
  }

  public subView(byteOffset: number, byteLength?: number): BufferView {
    return new BufferView(this, byteOffset, byteLength);
  }

  public getUint64(byteOffset: number, littleEndian?: boolean): number {
    // split 64-bit number into two 32-bit (4-byte) parts
    const left = this.getUint32(byteOffset, littleEndian);
    const right = this.getUint32(byteOffset + 4, littleEndian);

    // combine the two 32-bit values
    const combined = littleEndian
      ? left + 2 ** 32 * right
      : 2 ** 32 * left + right;

    assertBounds(combined, 8);
    return combined;
  }

  public setUint64(
    byteOffset: number,
    value: number,
    littleEndian?: boolean,
  ): void {
    assertBounds(value, 8);

    // bit shift won't work here because it's restricted to 32 bits
    const upper = Math.floor(value / 0x1_0000_0000);
    // truncate to uint32
    const lower = value >>> 0;

    if (littleEndian) {
      this.setUint32(byteOffset, lower, true);
      this.setUint32(byteOffset + 4, upper, true);
    } else {
      this.setUint32(byteOffset, upper, false);
      this.setUint32(byteOffset + 4, lower, false);
    }
  }

  public readString(
    encoding: "utf8" | "cp437",
    byteOffset = 0,
    byteLength?: number,
  ): string {
    const bytes = this.getOriginalBytes(byteOffset, byteLength);
    const decoder =
      encoding === "cp437" ? new CodePage437Decoder() : new TextDecoder();
    return decoder.decode(bytes);
  }

  public readUint8(byteOffset = 0): number {
    return this.getUint8(byteOffset);
  }
  public readUint16LE(byteOffset = 0): number {
    return this.getUint16(byteOffset, true);
  }
  public readUint32LE(byteOffset = 0): number {
    return this.getUint32(byteOffset, true);
  }
  public readUint64LE(byteOffset = 0): number {
    return this.getUint64(byteOffset, true);
  }

  public writeUint8(value: number, byteOffset = 0): void {
    assertBounds(value, 1);
    this.setUint8(byteOffset, value);
  }
  public writeUint16LE(value: number, byteOffset = 0): void {
    assertBounds(value, 2);
    this.setUint16(byteOffset, value, true);
  }
  public writeUint32LE(value: number, byteOffset = 0): void {
    assertBounds(value, 4);
    this.setUint32(byteOffset, value, true);
  }
  public writeUint64LE(value: number, byteOffset = 0): void {
    assertBounds(value, 8);
    this.setUint64(byteOffset, value, true);
  }
}

export class BitField {
  public constructor(
    public value = 0,
    public width = 16,
  ) {
    assert(width <= 32, `BitFields must be 32 bits or less`);
  }

  public getBit(bit: number): boolean {
    assert(
      Number.isInteger(bit) && bit >= 0 && bit < this.width,
      `can't get bit ${bit} of ${this.width} bit field`,
    );
    return (this.value & (1 << bit)) !== 0;
  }

  public setBit(bit: number, value: boolean): void {
    assert(
      Number.isInteger(bit) && bit >= 0 && bit < this.width,
      `can't set bit ${bit} of ${this.width} bit field`,
    );
    const bitMask = 1 << bit;
    if (value) {
      this.value |= bitMask;
    } else {
      this.value = (this.value | bit) ^ bit;
    }
  }
}
