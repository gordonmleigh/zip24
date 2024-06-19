import { BufferView, type BufferLike } from "./binary.js";
import { CodePage437Encoder } from "./cp437.js";
import { computeCrc32 } from "./crc32.js";
import { ZipFormatError, ZipSignatureError } from "./errors.js";
import {
  ExtendedDataTag,
  type CentralHeaderBase,
  type DecodedCentralHeader,
  type DecodedCentralHeaderWithLengths,
} from "./records.js";

export function readExtraFields(
  entry: Partial<DecodedCentralHeaderWithLengths>,
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
      case ExtendedDataTag.UnicodePathField:
        readUnicodeField(entry, view, offset);
        break;

      case ExtendedDataTag.Zip64ExtendedInfo:
        readZip64Field(entry, view, offset);
        break;
    }

    offset += size;
  }
}

export function readUnicodeField(
  entry: Partial<DecodedCentralHeader>,
  buffer: BufferLike,
  bufferOffset = 0,
): void {
  // | offset | field                   | size |
  // | ------ | ----------------------- | ---- |
  // | 0      | tag (0x6375 or 0x7075)  | 2    |
  // | 2      | size                    | 2    |
  // | 4      | version (0x01)          | 1    |
  // | 5      | crc32 of _header_ value | 4    |
  // | 9      | utf-8 encoded value     | ...  |

  const view = new BufferView(buffer, bufferOffset);
  const tag = view.readUint16LE(0) as ExtendedDataTag;
  const size = view.readUint16LE(2);
  const stringLength = size - 5; // size less version and crc32 fields
  const version = view.readUint8(4);

  let field: "comment" | "path";
  if (tag === ExtendedDataTag.UnicodeCommentField) {
    field = "comment";
  } else if (tag === ExtendedDataTag.UnicodePathField) {
    field = "path";
  } else {
    throw new ZipSignatureError("Info-ZIP unicode field", tag);
  }

  if (!entry[field]) {
    return;
  }

  if (version !== 1) {
    throw new ZipFormatError(
      `expected version 1 of unicode field, got ${version}`,
    );
  }

  const checkCrc32 = view.readUint32LE(5);

  const originalCrc32 = computeCrc32(
    new CodePage437Encoder().encode(entry[field]),
  );

  if (checkCrc32 === originalCrc32) {
    entry[field] = view.readString("utf8", 9, stringLength);
  }
}

export function readZip64Field(
  entry: Partial<CentralHeaderBase>,
  buffer: BufferLike,
  bufferOffset = 0,
): void {
  // ## Zip64 Extended Information Extra Field (4.5.3):

  // | offset | field                          | size |
  // | ------ | ------------------------------ | ---- |
  // | 0      | tag (0x0001)                   | 2    |
  // | 2      | size                           | 2    |
  // | 4      | uncompressed size (optional)   | 8    |
  // | ...    | compressed size (optional)     | 8    |
  // | ...    | local header offset (optional) | 8    |
  // | ...    | disk number (optional)         | 4    |
  const view = new BufferView(buffer, bufferOffset);
  const tag = view.readUint16LE(0) as ExtendedDataTag;
  const size = view.readUint16LE(2);

  if (tag !== ExtendedDataTag.Zip64ExtendedInfo) {
    throw new ZipSignatureError("Zip64 extended information extra field", tag);
  }

  let offset = 4;

  if (entry.uncompressedSize === 0xffff_ffff) {
    if (offset - 4 + 8 > size) {
      throw new ZipFormatError("Zip64 field not long enough");
    }
    entry.uncompressedSize = view.readUint64LE(offset);
    offset += 8;
  }
  if (entry.compressedSize === 0xffff_ffff) {
    if (offset - 4 + 8 > size) {
      throw new ZipFormatError("Zip64 field not long enough");
    }
    entry.compressedSize = view.readUint64LE(offset);
    offset += 8;
  }
  if (entry.localHeaderOffset === 0xffff_ffff) {
    if (offset - 4 + 8 > size) {
      throw new ZipFormatError("Zip64 field not long enough");
    }
    entry.localHeaderOffset = view.readUint64LE(offset);
    offset += 8;
  }
}
