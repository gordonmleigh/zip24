import {
  CompressionMethod,
  DosDate,
  DosFileAttributes,
  ExtendedDataTag,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
} from "../common.js";
import { assert, assertSignature } from "./assert.js";
import { BufferView, type BufferLike } from "./binary.js";
import { CodePage437Encoder } from "./cp437.js";
import { computeCrc32 } from "./crc32.js";
import {
  CentralHeaderLength,
  CentralHeaderSignature,
  LocalHeaderSignature,
} from "./signatures.js";

export type ZipEntry = {
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  externalFileAttributes?: DosFileAttributes | UnixFileAttributes;
  extraFieldLength: number;
  fileComment: string;
  fileCommentLength: number;
  fileName: string;
  fileNameLength: number;
  flags: GeneralPurposeFlags;
  internalFileAttributes: number;
  lastModified: Date;
  localHeaderOffset: number;
  platformMadeBy: ZipPlatform;
  uncompressedSize: number;
  versionMadeBy: ZipVersion;
  versionNeeded: ZipVersion;
};

export function readDirectoryEntry(
  entry: ZipEntry,
  buffer: BufferLike,
  bufferOffset = 0,
): void {
  readDirectoryHeader(entry, buffer, bufferOffset);
  readDirectoryVariableFields(entry, buffer, bufferOffset);
}

export function readDirectoryHeader(
  entry: ZipEntry,
  buffer: BufferLike,
  bufferOffset = 0,
): void {
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

  entry.versionMadeBy = view.readUint8(4);
  entry.platformMadeBy = view.readUint8(5);
  entry.versionNeeded = view.readUint16LE(6);
  entry.flags.value = view.readUint16LE(8);
  entry.compressionMethod = view.readUint16LE(10);
  entry.lastModified = DosDate.fromDosUint32(view.readUint32LE(12));
  entry.crc32 = view.readUint32LE(16);
  entry.compressedSize = view.readUint32LE(20);
  entry.uncompressedSize = view.readUint32LE(24);

  entry.fileNameLength = view.readUint16LE(28);
  entry.extraFieldLength = view.readUint16LE(30);
  entry.fileCommentLength = view.readUint16LE(32);

  const diskNumberStart = view.readUint16LE(34);
  assert(
    // 0xffff means that the actual value is stored in the zip64 eocdr
    diskNumberStart === 0 || diskNumberStart === 0xffff,
    `multi-disk zips not supported`,
  );

  entry.internalFileAttributes = view.readUint16LE(36);

  const externalFileAttributes = view.readUint32LE(38);
  if (entry.platformMadeBy === ZipPlatform.DOS) {
    entry.externalFileAttributes = new DosFileAttributes(
      externalFileAttributes & 0xff,
    );
  } else if (entry.platformMadeBy === ZipPlatform.UNIX) {
    entry.externalFileAttributes = new UnixFileAttributes(
      (externalFileAttributes >>> 16) & 0xffff,
    );
  }

  entry.localHeaderOffset = view.readUint32LE(42);
}

export function readDirectoryVariableFields(
  entry: ZipEntry,
  buffer: BufferLike,
  bufferOffset = 0,
): void {
  const view = new BufferView(buffer, bufferOffset);
  assertSignature(
    view.readUint32LE(0),
    CentralHeaderSignature,
    "CentralDirectoryHeader",
  );

  const encoding = entry.flags.hasUtf8Strings ? "utf8" : "cp437";

  entry.fileName = view.readString(
    encoding,
    CentralHeaderLength,
    entry.fileNameLength,
  );

  entry.fileComment = view.readString(
    encoding,
    CentralHeaderLength + entry.fileNameLength + entry.extraFieldLength,
    entry.fileCommentLength,
  );

  readExtraFields(
    entry,
    view,
    CentralHeaderLength + entry.fileNameLength,
    entry.extraFieldLength,
  );
}

export function readLocalHeaderSize(
  buffer: BufferLike,
  bufferOffset = 0,
): number {
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

  const fileNameLength = view.readUint16LE(26);
  const extraFieldLength = view.readUint16LE(28);
  return 30 + fileNameLength + extraFieldLength;
}

export function readExtraFields(
  entry: ZipEntry,
  buffer: BufferLike,
  bufferOffset = 0,
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
        readUnicodeField(entry, "fileComment", view, offset, size);
        break;

      case ExtendedDataTag.UnicodePathField:
        readUnicodeField(entry, "fileName", view, offset, size);
        break;

      case ExtendedDataTag.Zip64ExtendedInfo:
        readZip64Field(entry, view, offset, size);
        break;
    }

    offset += size;
  }
}

function readUnicodeField(
  entry: ZipEntry,
  field: "fileName" | "fileComment",
  buffer: BufferLike,
  bufferOffset: number,
  byteLength: number,
): void {
  if (!entry[field]) {
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
    new CodePage437Encoder().encode(entry[field]),
  );

  if (checkCrc32 === originalCrc32) {
    entry[field] = view.readString("utf8", 9);
  }
}

function readZip64Field(
  entry: ZipEntry,
  buffer: BufferLike,
  bufferOffset: number,
  byteLength: number,
): void {
  const view = new BufferView(buffer, bufferOffset, byteLength);
  let offset = 4;

  if (entry.uncompressedSize === 0xffff_ffff) {
    entry.uncompressedSize = view.readUint64LE(offset);
    offset += 8;
  }
  if (entry.compressedSize === 0xffff_ffff) {
    entry.compressedSize = view.readUint64LE(offset);
    offset += 8;
  }
  if (entry.localHeaderOffset === 0xffff_ffff) {
    entry.localHeaderOffset = view.readUint64LE(offset);
    offset += 8;
  }
}
