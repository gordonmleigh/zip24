import { assert } from "./assert.js";
import { CodePage437Decoder } from "./cp437.js";

function getUintUpperBound(bytes: number): number {
  switch (bytes) {
    case 1:
      return 0xff;

    case 2:
      return 0xffff;

    case 4:
      return 0xffff_ffff;

    case 8:
      return Number.MAX_SAFE_INTEGER;

    /* c8 ignore next 2 */
    default:
      throw new TypeError(`expected bytes to be 1, 2, 4 or 8`);
  }
}

function outOfBounds(value: number, bytes: number): boolean {
  return (
    !Number.isInteger(value) || value < 0 || value > getUintUpperBound(bytes)
  );
}

class UintBoundsError extends RangeError {
  // eslint-disable-next-line unicorn/custom-error-definition -- RangeError is fine
  public constructor(value: number, bytes: number) {
    super(`${value} is outside the range for ${bytes} byte unsigned integer`);
  }
}

export type BufferLike = ArrayBuffer | ArrayBufferView;

export function makeSubUint8Array(
  source: BufferLike,
  byteOffset?: number,
  byteLength?: number,
): Uint8Array {
  return new Uint8Array(
    ...normalizeBufferRange(source, byteOffset, byteLength),
  );
}

export function normalizeBufferRange(
  source: BufferLike,
  byteOffset = 0,
  byteLength = source.byteLength - byteOffset,
): [ArrayBuffer, number, number] {
  if (ArrayBuffer.isView(source)) {
    if (byteOffset + byteLength > source.byteLength) {
      throw new RangeError(
        `offset + length must be less than the source buffer length`,
      );
    }
    return [source.buffer, source.byteOffset + byteOffset, byteLength];
  }
  return [source, byteOffset, byteLength];
}

/**
 * Extension of {@link DataView} with API like Node's {@link Buffer}.
 */
export class BufferView extends DataView {
  public static alloc(byteLength: number): BufferView {
    return new BufferView(new ArrayBuffer(byteLength));
  }

  public static makeOrAlloc(
    requiredLength: number,
    buffer: BufferLike | undefined,
    byteOffset?: number,
    byteLength?: number,
  ): BufferView {
    if (buffer) {
      assert(
        byteLength === undefined || byteLength >= requiredLength,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        `the buffer must be at least ${requiredLength} bytes (got ${byteLength!})`,
      );
      return new BufferView(buffer, byteOffset, requiredLength);
    }
    return BufferView.alloc(requiredLength);
  }

  public constructor(buffer: BufferLike, byteOffset = 0, byteLength?: number) {
    super(...normalizeBufferRange(buffer, byteOffset, byteLength));
  }

  /**
   * Get a Uint8Array that points to the ArrayBuffer that backs this instance.
   */
  public getOriginalBytes(byteOffset = 0, byteLength?: number): Uint8Array {
    return new Uint8Array(
      ...normalizeBufferRange(this, byteOffset, byteLength),
    );
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

    if (outOfBounds(combined, 8)) {
      throw new UintBoundsError(combined, 8);
    }
    return combined;
  }

  public setUint64(
    byteOffset: number,
    value: number,
    littleEndian?: boolean,
  ): void {
    if (outOfBounds(value, 8)) {
      throw new UintBoundsError(value, 8);
    }

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
    byteOffset: number,
    byteLength?: number,
  ): string {
    const bytes = this.getOriginalBytes(byteOffset, byteLength);
    const decoder =
      encoding === "cp437" ? new CodePage437Decoder() : new TextDecoder();
    return decoder.decode(bytes);
  }

  public readUint8(byteOffset: number): number {
    return this.getUint8(byteOffset);
  }
  public readUint16LE(byteOffset: number): number {
    return this.getUint16(byteOffset, true);
  }
  public readUint32LE(byteOffset: number): number {
    return this.getUint32(byteOffset, true);
  }
  public readUint64LE(byteOffset: number): number {
    return this.getUint64(byteOffset, true);
  }

  public writeUint8(value: number, byteOffset: number): void {
    if (outOfBounds(value, 1)) {
      throw new UintBoundsError(value, 1);
    }
    this.setUint8(byteOffset, value);
  }
  public writeUint16LE(value: number, byteOffset: number): void {
    if (outOfBounds(value, 2)) {
      throw new UintBoundsError(value, 2);
    }
    this.setUint16(byteOffset, value, true);
  }
  public writeUint32LE(value: number, byteOffset: number): void {
    if (outOfBounds(value, 4)) {
      throw new UintBoundsError(value, 4);
    }
    this.setUint32(byteOffset, value, true);
  }
  public writeUint64LE(value: number, byteOffset: number): void {
    if (outOfBounds(value, 8)) {
      throw new UintBoundsError(value, 8);
    }
    this.setUint64(byteOffset, value, true);
  }
}

export class BitField {
  public static flag(bit: number, width = 32): number {
    this.validateWidth(width);

    if (!Number.isInteger(bit)) {
      throw new TypeError(`bit must be an integer`);
    }
    if (bit < 0 || bit >= width) {
      throw new RangeError(`can't index bit ${bit} of ${width} bit field`);
    }
    return (1 << bit) >>> 0;
  }

  private static validateWidth(width: number): void {
    if (!Number.isInteger(width)) {
      throw new TypeError(`width must be an integer`);
    }
    if (width < 0 || width > 32) {
      throw new RangeError(`BitFields must be 32 bits or less`);
    }
  }

  private valueInternal = 0;

  public get value(): number {
    return this.valueInternal;
  }
  public set value(value: number) {
    if (!Number.isInteger(value)) {
      throw new TypeError(`value must be an integer`);
    }
    if (value < 0 || value >= 2 ** this.width) {
      throw new RangeError(`value must be within width`);
    }
    this.valueInternal = value;
  }

  public constructor(
    public readonly width = 16,
    value = 0,
  ) {
    BitField.validateWidth(width);
    this.value = value;
  }

  public getBit(bit: number): boolean {
    return (this.value & BitField.flag(bit, this.width)) !== 0;
  }

  public setBit(bit: number, value: boolean): void {
    const bitMask = BitField.flag(bit, this.width);
    if (value) {
      this.value |= bitMask;
    } else {
      this.value = (this.value | bitMask) ^ bitMask;
    }
  }
}
