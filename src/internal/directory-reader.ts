import {
  CompressionMethod,
  DosDate,
  GeneralPurposeFlags,
  ZipPlatform,
  ZipVersion,
} from "../common.js";
import { assert, assertSignature } from "./assert.js";
import { BufferView, type BufferLike } from "./binary.js";
import {
  ExtraFieldReader,
  type OverridableFileInfo,
} from "./extra-field-reader.js";
import { CentralHeaderSignature } from "./signatures.js";

export class ZipDirectoryReader implements OverridableFileInfo {
  public static readonly fixedFieldsLength = 46;

  public platformMadeBy = ZipPlatform.DOS;
  public versionMadeBy = ZipVersion.Zip64;
  public versionNeeded = ZipVersion.Zip64;
  public readonly flags = new GeneralPurposeFlags();
  public compressionMethod = CompressionMethod.Deflate;
  public lastModified = new Date();
  public crc32 = 0;
  public compressedSize = 0;
  public uncompressedSize = 0;
  public fileNameLength = 0;
  public extraFieldLength = 0;
  public fileCommentLength = 0;
  public internalFileAttributes = 0;
  public externalFileAttributes = 0;
  public localHeaderOffset = 0;
  public fileName = "";
  public fileComment = "";

  public readonly fixedFieldsLength = ZipDirectoryReader.fixedFieldsLength;
  public readonly fileNameOffset = this.fixedFieldsLength;

  public get extraFieldOffset(): number {
    return this.fileNameOffset + this.fileNameLength;
  }

  public get fileCommentOffset(): number {
    return this.extraFieldOffset + this.extraFieldLength;
  }

  public get variableDataLength(): number {
    return this.fileNameLength + this.extraFieldLength + this.fileCommentLength;
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
    const view = new BufferView(buffer, bufferOffset);

    assertSignature(
      view.readUint32LE(0),
      CentralHeaderSignature,
      "CentralDirectoryHeader",
    );

    this.versionMadeBy = view.readUint8(4);
    this.platformMadeBy = view.readUint8(5);
    this.versionNeeded = view.readUint16LE(6);
    this.flags.value = view.readUint16LE(8);
    this.compressionMethod = view.readUint16LE(10);
    this.lastModified = DosDate.fromDosUint32(view.readUint32LE(12));
    this.crc32 = view.readUint32LE(16);
    this.compressedSize = view.readUint32LE(20);
    this.uncompressedSize = view.readUint32LE(24);

    this.fileNameLength = view.readUint16LE(28);
    this.extraFieldLength = view.readUint16LE(30);
    this.fileCommentLength = view.readUint16LE(32);

    const diskNumberStart = view.readUint16LE(34);
    assert(
      // 0xffff means that the actual value is stored in the zip64 eocdr
      diskNumberStart === 0 || diskNumberStart === 0xffff,
      `multi-disk zips not supported`,
    );

    this.internalFileAttributes = view.readUint16LE(36);
    this.externalFileAttributes = view.readUint32LE(38);
    this.localHeaderOffset = view.readUint16LE(42);

    return this.fixedFieldsLength;
  }

  public readDataFields(buffer: BufferLike, bufferOffset?: number): number {
    const view = new BufferView(buffer, bufferOffset);
    assertSignature(
      view.readUint32LE(0),
      CentralHeaderSignature,
      "CentralDirectoryHeader",
    );

    const encoding = this.flags.hasUtf8Strings ? "utf8" : "cp437";

    this.fileName = view.readString(
      encoding,
      this.fileNameOffset,
      this.fileNameLength,
    );

    this.fileComment = view.readString(
      encoding,
      this.fileCommentOffset,
      this.fileCommentLength,
    );

    const fields = new ExtraFieldReader(this);
    fields.read(view, this.extraFieldOffset, this.extraFieldLength);

    return this.variableDataLength;
  }
}
