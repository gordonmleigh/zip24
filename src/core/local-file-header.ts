import { BufferView, type BufferLike } from "../util/binary.js";
import { DosDate } from "../util/dos-date.js";
import { EncodedString } from "../util/encoded-string.js";
import { makeBuffer, type Serializable } from "../util/serialization.js";
import { CompressionMethod } from "./compression-core.js";
import { ExtraFieldTag, ZipVersion } from "./constants.js";
import { ZipSignatureError } from "./errors.js";
import {
  ExtraFieldCollection,
  Zip64ExtraField,
} from "./extra-field-collection.js";
import { GeneralPurposeFlags } from "./flags.js";

export type LocalFileHeaderInit = {
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  extraField: ExtraFieldCollection;
  flags: GeneralPurposeFlags;
  lastModified: Date;
  path: Uint8Array | string;
  uncompressedSize: number;
  versionNeeded: ZipVersion;
  zip64?: boolean;
};

export class LocalFileHeader implements Serializable {
  // Local File Header (4.3.7)
  //
  // | offset | field                     | size |
  // | ------ | ------------------------- | ---- |
  // | 0      | signature (0x04034b50)    | 4    |
  // | 4      | version needed to extract | 2    |
  // | 6      | general purpose bit flag  | 2    |
  // | 8      | compression method        | 2    |
  // | 10     | last mod file time        | 2    |
  // | 12     | last mod file date        | 2    |
  // | 14     | crc-32                    | 4    |
  // | 18     | compressed size           | 4    |
  // | 22     | uncompressed size         | 4    |
  // | 26     | file name length          | 2    |
  // | 28     | extra field length        | 2    |
  // | 30     | file name                 | ...  |
  // | ...    | extra field               | ...  |

  public static readonly FixedSize = 30;
  public static readonly Signature = 0x04034b50;

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): LocalFileHeader {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("local file header", signature);
    }

    const versionNeeded = view.readUint16LE(4);

    const flags = new GeneralPurposeFlags(view.readUint16LE(6));
    const compressionMethod = view.readUint16LE(8);
    const lastModified = DosDate.fromDosUint32(view.readUint32LE(10));
    const crc32 = view.readUint32LE(14);
    const compressedSize = view.readUint32LE(18);
    const uncompressedSize = view.readUint32LE(22);

    const pathLength = view.readUint16LE(26);
    const extraFieldLength = view.readUint16LE(28);

    const path = view.getOriginalBytes(30, pathLength);

    const extraField = ExtraFieldCollection.deserialize(
      view,
      30 + pathLength,
      extraFieldLength,
    );

    return new this({
      compressedSize,
      compressionMethod,
      crc32,
      extraField,
      flags,
      lastModified,
      path,
      uncompressedSize,
      versionNeeded,
    });
  }

  public static readTotalSize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): number {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("local file header", signature);
    }

    const pathLength = view.readUint16LE(26);
    const extraFieldLength = view.readUint16LE(28);

    return LocalFileHeader.FixedSize + pathLength + extraFieldLength;
  }

  public compressedSize: number;
  public compressionMethod: CompressionMethod;
  public crc32: number;
  public extraField: ExtraFieldCollection;
  public flags: GeneralPurposeFlags;
  public lastModified: Date;
  public path: string;
  public rawPath: EncodedString;
  public uncompressedSize: number;
  public versionNeeded: ZipVersion;
  public zip64: boolean;

  public constructor(init: LocalFileHeaderInit) {
    this.compressedSize = init.compressedSize;
    this.compressionMethod = init.compressionMethod;
    this.crc32 = init.crc32;
    this.extraField = init.extraField;
    this.flags = init.flags;
    this.lastModified = init.lastModified;
    this.uncompressedSize = init.uncompressedSize;
    this.versionNeeded = init.versionNeeded;

    const encoding = this.flags.hasUtf8Strings ? "utf8" : "cp437";
    this.rawPath = new EncodedString(encoding, init.path);

    this.path = this.extraField.fallbackUnicode(
      this.rawPath,
      ExtraFieldTag.UnicodePathField,
    );

    const zip64Field = this.extraField.getField(
      ExtraFieldTag.Zip64ExtendedInfo,
    );
    this.zip64 = !!init.zip64 || !!zip64Field;
    zip64Field?.readFields(this);
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const extraField = new ExtraFieldCollection(
      this.extraField.fields.filter(
        (x) => (x.tag as ExtraFieldTag) !== ExtraFieldTag.Zip64ExtendedInfo,
      ),
    );

    if (this.zip64) {
      extraField.fields.push(Zip64ExtraField.from(this));
    }

    const view = makeBuffer(
      LocalFileHeader.FixedSize +
        this.rawPath.byteLength +
        extraField.byteLength,
      buffer,
      byteOffset,
      byteLength,
    );

    view.writeUint32LE(LocalFileHeader.Signature, 0);
    view.writeUint16LE(this.versionNeeded, 4);
    view.writeUint16LE(this.flags.value, 6);
    view.writeUint16LE(this.compressionMethod, 8);
    view.writeUint32LE(new DosDate(this.lastModified).getDosDateTime(), 10);

    view.writeUint32LE(this.crc32, 14);

    if (this.zip64) {
      view.writeUint32LE(0xffff_ffff, 18); // compressedSize
      view.writeUint32LE(0xffff_ffff, 22); // uncompressedSize
    } else if (this.flags.hasDataDescriptor) {
      view.writeUint32LE(0, 14); // crc32
      view.writeUint32LE(0, 18); // compressedSize
      view.writeUint32LE(0, 22); // uncompressedSize
    } else {
      view.writeUint32LE(this.compressedSize, 18);
      view.writeUint32LE(this.uncompressedSize, 22);
    }
    view.writeUint16LE(this.rawPath.byteLength, 26);
    view.writeUint16LE(extraField.byteLength, 28);

    let offset = 30;

    view.setBytes(offset, this.rawPath);
    offset += this.rawPath.byteLength;

    extraField.serialize(view, offset);

    return view.getOriginalBytes();
  }
}
