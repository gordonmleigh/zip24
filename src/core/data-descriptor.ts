import type { BufferLike } from "../util/binary.js";
import { makeBuffer, type Serializable } from "../util/serialization.js";

export type DataDescriptorFields = {
  compressedSize: number;
  crc32: number;
  uncompressedSize: number;
};

export class DataDescriptor implements DataDescriptorFields, Serializable {
  // 32-bit Data Descriptor (4.3.9)
  //
  // | offset | field                  | size |
  // | ------ | ---------------------- | ---- |
  // | 0      | signature (0x08074b50) | 4    |
  // | 4      | crc-32                 | 4    |
  // | 8      | compressed size        | 4    |
  // | 12     | uncompressed size      | 4    |
  // | 16     | (end)                  |      |

  // 64-bit Data Descriptor (4.3.9)
  //
  // | offset | field                  | size |
  // | ------ | ---------------------- | ---- |
  // | 0      | signature (0x08074b50) | 4    |
  // | 4      | crc-32                 | 4    |
  // | 8      | compressed size        | 8    |
  // | 16     | uncompressed size      | 8    |
  // | 24     | (end)                  |      |

  public static readonly FixedSize32 = 16;
  public static readonly FixedSize64 = 24;
  public static readonly Signature = 0x08074b50;

  public compressedSize = 0;
  public crc32 = 0;
  public uncompressedSize = 0;
  public is64bit: boolean;

  public constructor(fields?: DataDescriptorFields, is64bit = false) {
    if (fields) {
      this.compressedSize = fields.compressedSize;
      this.crc32 = fields.crc32;
      this.uncompressedSize = fields.uncompressedSize;
    }
    this.is64bit = is64bit;
  }

  public serialize(
    buffer?: BufferLike | undefined,
    byteOffset?: number | undefined,
    byteLength?: number | undefined,
  ): Uint8Array {
    const view = makeBuffer(
      this.is64bit ? DataDescriptor.FixedSize64 : DataDescriptor.FixedSize32,
      buffer,
      byteOffset,
      byteLength,
    );

    view.writeUint32LE(DataDescriptor.Signature, 0);
    view.writeUint32LE(this.crc32, 4);

    if (this.is64bit) {
      view.writeUint64LE(this.compressedSize, 8);
      view.writeUint64LE(this.uncompressedSize, 16);
    } else {
      view.writeUint32LE(this.compressedSize, 8);
      view.writeUint32LE(this.uncompressedSize, 12);
    }

    return view.getOriginalBytes();
  }
}
