import { BufferView, type BufferLike } from "../util/binary.js";
import { DosDate } from "../util/dos-date.js";
import { EncodedString } from "../util/encoded-string.js";
import { makeBuffer, type Serializable } from "../util/serialization.js";
import { CompressionMethod } from "./compression-core.js";
import { ExtraFieldTag, ZipPlatform, ZipVersion } from "./constants.js";
import { MultiDiskError, ZipSignatureError } from "./errors.js";
import {
  ExtraFieldCollection,
  Zip64ExtraField,
} from "./extra-field-collection.js";
import {
  getAttributesPlatform,
  makePlatformAttributes,
  type FileAttributes,
} from "./file-attributes.js";
import { GeneralPurposeFlags } from "./flags.js";

export type CentralDirectoryHeaderInit = {
  attributes: FileAttributes;
  comment: Uint8Array | string;
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  extraField: ExtraFieldCollection;
  flags: GeneralPurposeFlags;
  lastModified: Date;
  localHeaderOffset: number;
  path: Uint8Array | string;
  uncompressedSize: number;
  versionMadeBy: ZipVersion;
  versionNeeded: ZipVersion;
  zip64?: boolean;
};

export class CentralDirectoryHeader implements Serializable {
  // Central Directory Header (4.3.12)
  //
  // | offset | field                           | size |
  // | ------ | ------------------------------- | ---- |
  // | 0      | signature (0x02014b50)          | 4    |
  // | 4      | version made by                 | 2    |
  // | 6      | version needed to extract       | 2    |
  // | 8      | general purpose bit flag        | 2    |
  // | 10     | compression method              | 2    |
  // | 12     | last mod file time              | 2    |
  // | 14     | last mod file date              | 2    |
  // | 16     | crc-32                          | 4    |
  // | 20     | compressed size                 | 4    |
  // | 24     | uncompressed size               | 4    |
  // | 28     | file name length                | 2    |
  // | 30     | extra field length              | 2    |
  // | 32     | file comment length             | 2    |
  // | 34     | disk number start               | 2    |
  // | 36     | internal file attributes        | 2    |
  // | 38     | external file attributes        | 4    |
  // | 42     | relative offset of local header | 4    |
  // | 46     | file name (variable size)       |      |
  // |        | extra field (variable size)     |      |
  // |        | file comment (variable size)    |      |

  public static readonly FixedSize = 46;
  public static readonly Signature = 0x02014b50;

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): CentralDirectoryHeader {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("central directory header", signature);
    }

    const versionMadeBy = view.readUint8(4);
    const platformMadeBy = view.readUint8(5);
    const versionNeeded = view.readUint16LE(6);

    const flags = new GeneralPurposeFlags(view.readUint16LE(8));
    const compressionMethod = view.readUint16LE(10);
    const lastModified = DosDate.fromDosUint32(view.readUint32LE(12));
    const crc32 = view.readUint32LE(16);
    const compressedSize = view.readUint32LE(20);
    const uncompressedSize = view.readUint32LE(24);

    const pathLength = view.readUint16LE(28);
    const extraFieldLength = view.readUint16LE(30);
    const commentLength = view.readUint16LE(32);

    const diskNumberStart = view.readUint16LE(34);

    // 0xffff means that the actual value is stored in the zip64 eocdr
    if (diskNumberStart !== 0 && diskNumberStart !== 0xffff) {
      throw new MultiDiskError();
    }

    const attributes = makePlatformAttributes(
      platformMadeBy as ZipPlatform,
      view.readUint32LE(38),
    );

    const localHeaderOffset = view.readUint32LE(42);
    const path = view.getOriginalBytes(46, pathLength);

    const extraField = ExtraFieldCollection.deserialize(
      view,
      46 + pathLength,
      extraFieldLength,
    );

    const comment = view.getOriginalBytes(
      46 + pathLength + extraFieldLength,
      commentLength,
    );

    return new this({
      attributes,
      comment,
      compressedSize,
      compressionMethod,
      crc32,
      extraField,
      flags,
      lastModified,
      localHeaderOffset,
      path,
      uncompressedSize,
      versionMadeBy,
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
      throw new ZipSignatureError("central directory header", signature);
    }

    const pathLength = view.readUint16LE(28);
    const extraFieldLength = view.readUint16LE(30);
    const commentLength = view.readUint16LE(32);

    return (
      CentralDirectoryHeader.FixedSize +
      pathLength +
      extraFieldLength +
      commentLength
    );
  }

  public attributes: FileAttributes;
  public comment: string;
  public compressedSize: number;
  public compressionMethod: CompressionMethod;
  public crc32: number;
  public extraField: ExtraFieldCollection;
  public flags: GeneralPurposeFlags;
  public lastModified: Date;
  public localHeaderOffset: number;
  public path: string;
  public rawComment: EncodedString;
  public rawPath: EncodedString;
  public uncompressedSize: number;
  public versionMadeBy: ZipVersion;
  public versionNeeded: ZipVersion;
  public zip64: boolean;

  public get totalSize(): number {
    return (
      CentralDirectoryHeader.FixedSize +
      this.rawPath.byteLength +
      this.extraField.byteLength +
      this.rawComment.byteLength
    );
  }

  public get platformMadeBy(): ZipPlatform {
    return getAttributesPlatform(this.attributes);
  }

  public constructor(init: CentralDirectoryHeaderInit) {
    this.attributes = init.attributes;
    this.compressedSize = init.compressedSize;
    this.compressionMethod = init.compressionMethod;
    this.crc32 = init.crc32;
    this.extraField = init.extraField;
    this.flags = init.flags;
    this.lastModified = init.lastModified;
    this.localHeaderOffset = init.localHeaderOffset;
    this.uncompressedSize = init.uncompressedSize;
    this.versionMadeBy = init.versionMadeBy;
    this.versionNeeded = init.versionNeeded;

    const encoding = this.flags.hasUtf8Strings ? "utf8" : "cp437";
    this.rawComment = new EncodedString(encoding, init.comment);
    this.rawPath = new EncodedString(encoding, init.path);

    this.comment = this.extraField.fallbackUnicode(
      this.rawComment,
      ExtraFieldTag.UnicodeCommentField,
    );

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
      CentralDirectoryHeader.FixedSize +
        this.rawPath.byteLength +
        extraField.byteLength +
        this.rawComment.byteLength,
      buffer,
      byteOffset,
      byteLength,
    );

    view.writeUint32LE(CentralDirectoryHeader.Signature, 0);
    view.writeUint8(this.versionMadeBy, 4);
    view.writeUint8(this.platformMadeBy, 5);
    view.writeUint16LE(this.versionNeeded, 6);
    view.writeUint16LE(this.flags.value, 8);
    view.writeUint16LE(this.compressionMethod, 10);
    view.writeUint32LE(new DosDate(this.lastModified).getDosDateTime(), 12);
    view.writeUint32LE(this.crc32, 16);
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.compressedSize, 20);
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.uncompressedSize, 24);
    view.writeUint16LE(this.rawPath.byteLength, 28);
    view.writeUint16LE(extraField.byteLength, 30);
    view.writeUint16LE(this.rawComment.byteLength, 32);
    view.writeUint16LE(0, 34); // disk number start
    view.writeUint16LE(0, 36); // internal file attributes
    view.writeUint32LE(this.attributes.rawValue, 38);
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.localHeaderOffset, 42);

    let offset = 46;

    view.setBytes(offset, this.rawPath);
    offset += this.rawPath.byteLength;

    extraField.serialize(view, offset);
    offset += extraField.byteLength;

    view.setBytes(offset, this.rawComment);
    return view.getOriginalBytes();
  }
}
