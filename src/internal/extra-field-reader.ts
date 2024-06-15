import { BufferView, type BufferLike } from "./binary.js";
import { CodePage437Encoder } from "./cp437.js";
import { computeCrc32 } from "./crc32.js";

enum ExtendedDataTag {
  Zip64ExtendedInfo = 0x01,
  UnicodeCommentField = 0x6375,
  UnicodePathField = 0x7075,
  Unix = 0x0d,
}

export type OverridableFileInfo = {
  fileName: string;
  fileComment?: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset?: number;
};

export class ExtraFieldReader {
  public constructor(private readonly header: OverridableFileInfo) {}

  public read(
    buffer: BufferLike,
    bufferOffset?: number,
    byteLength?: number,
  ): void {
    // | offset | field | size |
    // | ------ | ----- | ---- |
    // | 0      | tag   | 2    |
    // | 2      | size  | 2    |
    const view = new BufferView(buffer, bufferOffset, byteLength);

    let offset = 0;
    while (offset < view.byteLength) {
      const tag = view.readUint16LE(offset) as ExtendedDataTag;
      const size = 4 + view.readUint16LE(offset + 2);

      switch (tag) {
        case ExtendedDataTag.UnicodeCommentField:
          this.readUnicodeField("fileComment", view, offset, size);
          break;

        case ExtendedDataTag.UnicodePathField:
          this.readUnicodeField("fileName", view, offset, size);
          break;

        case ExtendedDataTag.Zip64ExtendedInfo:
          this.readZip64Field(view, offset, size);
          break;
      }

      offset += size;
    }
  }

  private readUnicodeField(
    field: "fileName" | "fileComment",
    buffer: BufferLike,
    bufferOffset: number,
    byteLength: number,
  ): void {
    if (this.header[field] === undefined) {
      return;
    }

    // | offset | field                   | size |
    // | ------ | ----------------------- | ---- |
    // | 0      | tag (0x6375 or 0x7075)  | 2    |
    // | 2      | size                    | 2    |
    // | 4      | version (0x01)          | 1    |
    // | 5      | crc32 of _header_ value | 4    |
    // | 9      | utf-8 encoded value     | ...  |

    const view = new BufferView(buffer, bufferOffset, byteLength);
    const version = view.readUint8(4);

    if (version !== 1) {
      throw new Error(`expected version 1 of unicode field, got ${version}`);
    }

    const checkCrc32 = view.readUint32LE(5);

    const originalCrc32 = computeCrc32(
      new CodePage437Encoder().encode(this.header[field]),
    );

    if (checkCrc32 === originalCrc32) {
      this.header[field] = view.readString("utf8", 9);
    }
  }

  private readZip64Field(
    buffer: BufferLike,
    bufferOffset: number,
    byteLength: number,
  ): void {
    const view = new BufferView(buffer, bufferOffset, byteLength);
    let offset = 4;

    if (this.header.uncompressedSize === 0xffff_ffff) {
      this.header.uncompressedSize = view.readUint64LE(offset);
      offset += 8;
    }
    if (this.header.compressedSize === 0xffff_ffff) {
      this.header.compressedSize = view.readUint64LE(offset);
      offset += 8;
    }
    if (this.header.localHeaderOffset === 0xffff_ffff) {
      this.header.localHeaderOffset = view.readUint64LE(offset);
      offset += 8;
    }
  }
}
