import { assert } from "./assert.js";
import { BufferView, type BufferLike } from "./binary.js";
import { ZipSignatureError } from "./errors.js";
import { readExtraFields } from "./extra-fields.js";
import {
  DosDate,
  GeneralPurposeFlags,
  makePlatformAttributes,
} from "./field-types.js";
import type {
  CentralHeaderDecodedVariableFields,
  CentralHeaderFixedFields,
  CentralHeaderLengthFields,
  DecodedCentralHeaderWithLengths,
} from "./records.js";
import { CentralHeaderLength, CentralHeaderSignature } from "./signatures.js";

export function readDirectoryEntry(
  entry: Partial<DecodedCentralHeaderWithLengths>,
  buffer: BufferLike,
  bufferOffset = 0,
): asserts entry is DecodedCentralHeaderWithLengths {
  readDirectoryHeader(entry, buffer, bufferOffset);
  readDirectoryVariableFields(entry, buffer, bufferOffset);
}

export function readDirectoryHeader(
  entry: Partial<DecodedCentralHeaderWithLengths>,
  buffer: BufferLike,
  bufferOffset = 0,
): asserts entry is DecodedCentralHeaderWithLengths {
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
  const signature = view.readUint32LE(0);

  if (signature !== CentralHeaderSignature) {
    throw new ZipSignatureError("central directory header", signature);
  }

  entry.versionMadeBy = view.readUint8(4);
  entry.platformMadeBy = view.readUint8(5);
  entry.versionNeeded = view.readUint16LE(6);

  const flags = view.readUint16LE(8);
  if (entry.flags === undefined) {
    entry.flags = new GeneralPurposeFlags(flags);
  } else {
    entry.flags.value = flags;
  }

  entry.flags.value = view.readUint16LE(8);
  entry.compressionMethod = view.readUint16LE(10);
  entry.lastModified = DosDate.fromDosUint32(view.readUint32LE(12));
  entry.crc32 = view.readUint32LE(16);
  entry.compressedSize = view.readUint32LE(20);
  entry.uncompressedSize = view.readUint32LE(24);

  entry.pathLength = view.readUint16LE(28);
  entry.extraFieldLength = view.readUint16LE(30);
  entry.commentLength = view.readUint16LE(32);

  const diskNumberStart = view.readUint16LE(34);
  assert(
    // 0xffff means that the actual value is stored in the zip64 eocdr
    diskNumberStart === 0 || diskNumberStart === 0xffff,
    `multi-disk zips not supported`,
  );

  entry.internalAttributes = view.readUint16LE(36);

  entry.attributes = makePlatformAttributes(
    entry.platformMadeBy,
    view.readUint32LE(38),
  );

  entry.localHeaderOffset = view.readUint32LE(42);
}

export function getDirectoryHeaderLength(
  entry: CentralHeaderLengthFields,
): number {
  return (
    CentralHeaderLength +
    entry.pathLength +
    entry.extraFieldLength +
    entry.commentLength
  );
}

export function readDirectoryVariableFields(
  entry: CentralHeaderFixedFields & Partial<CentralHeaderDecodedVariableFields>,
  buffer: BufferLike,
  bufferOffset = 0,
): asserts entry is DecodedCentralHeaderWithLengths {
  const view = new BufferView(buffer, bufferOffset);
  const signature = view.readUint32LE(0);

  if (signature !== CentralHeaderSignature) {
    throw new ZipSignatureError("central directory header", signature);
  }

  const encoding = entry.flags?.hasUtf8Strings ? "utf8" : "cp437";

  entry.path = view.readString(encoding, CentralHeaderLength, entry.pathLength);

  entry.comment = view.readString(
    encoding,
    CentralHeaderLength + entry.pathLength + entry.extraFieldLength,
    entry.commentLength,
  );

  readExtraFields(
    entry,
    view,
    CentralHeaderLength + entry.pathLength,
    entry.extraFieldLength,
  );
}
