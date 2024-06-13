import {
  CompressionMethod,
  DosDate,
  GeneralPurposeFlags,
  ZipVersion,
} from "../common.js";
import { assertSignature } from "./assert.js";
import { BufferView, type BufferLike } from "./binary.js";
import {
  ExtraFieldReader,
  type OverridableFileInfo,
} from "./extra-field-reader.js";
import { LocalHeaderSignature } from "./signatures.js";

export class LocalHeaderReader implements OverridableFileInfo {
  public static readonly fixedFieldsLength = 30;

  public versionNeeded = ZipVersion.Zip64;
  public readonly flags = new GeneralPurposeFlags();
  public compressionMethod = CompressionMethod.Deflate;
  public lastModified = new Date();
  public crc32 = 0;
  public compressedSize = 0;
  public uncompressedSize = 0;
  public fileNameLength = 0;
  public extraFieldLength = 0;
  public fileName = "";

  public readonly fixedFieldsLength = LocalHeaderReader.fixedFieldsLength;
  public readonly fileNameOffset = this.fixedFieldsLength;

  public get extraFieldOffset(): number {
    return this.fileNameOffset + this.fileNameLength;
  }

  public get variableDataLength(): number {
    return this.fileNameLength + this.extraFieldLength;
  }

  public get totalRecordLength(): number {
    return this.fixedFieldsLength + this.variableDataLength;
  }

  public read(buffer: BufferLike, bufferOffset = 0): number {
    this.readHeader(buffer, bufferOffset);
    this.readDataFields(buffer, bufferOffset);
    return this.totalRecordLength;
  }

  public readHeader(buffer: BufferLike, bufferOffset = 0): number {
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
    const view = new BufferView(buffer, bufferOffset);

    assertSignature(
      view.readUint32LE(0),
      LocalHeaderSignature,
      "LocalFileHeader",
    );

    this.versionNeeded = view.readUint16LE(4);
    this.flags.value = view.readUint16LE(6);
    this.compressionMethod = view.readUint16LE(8);
    this.lastModified = DosDate.fromDosUint32(view.readUint32LE(10));
    this.crc32 = view.readUint32LE(14);
    this.compressedSize = view.readUint32LE(18);
    this.uncompressedSize = view.readUint32LE(22);

    this.fileNameLength = view.readUint16LE(26);
    this.extraFieldLength = view.readUint16LE(28);

    return this.fixedFieldsLength;
  }

  public readDataFields(buffer: BufferLike, bufferOffset?: number): number {
    const view = new BufferView(buffer, bufferOffset);
    assertSignature(
      view.readUint32LE(0),
      LocalHeaderSignature,
      "LocalFileHeader",
    );
    const encoding = this.flags.hasUtf8Strings ? "utf8" : "cp437";

    this.fileName = view.readString(
      encoding,
      this.fileNameOffset,
      this.fileNameLength,
    );

    const fields = new ExtraFieldReader(this);
    fields.read(view, this.extraFieldOffset, this.extraFieldLength);

    return this.variableDataLength;
  }
}
