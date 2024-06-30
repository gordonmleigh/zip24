import { BufferView, type BufferLike } from "../util/binary.js";
import { DosDate } from "../util/dos-date.js";
import type { DataDescriptor } from "./compression-core.js";
import { ZipSignatureError } from "./errors.js";
import { Zip64ExtraField } from "./extra-field-collection.js";
import type { RawLocalHeader } from "./records.js";
import { DataDescriptorSignature, LocalHeaderSignature } from "./signatures.js";

export type LocalHeaderOptions = {
  zip64?: boolean;
};

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
  const signature = view.readUint32LE(0);

  if (signature !== LocalHeaderSignature) {
    throw new ZipSignatureError("local header", signature);
  }

  const fileNameLength = view.readUint16LE(26);
  const extraFieldLength = view.readUint16LE(28);
  return 30 + fileNameLength + extraFieldLength;
}

export function writeLocalHeader(
  entry: RawLocalHeader,
  options?: LocalHeaderOptions,
): Uint8Array {
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

  const hasDataDescriptor = entry.flags.hasDataDescriptor;
  const zip64 = !!options?.zip64;

  let zip64ExtraField: Uint8Array | undefined;
  if (zip64) {
    // if there's a data descriptor _and_ zip64, then the header values are
    // set to ffffffff to indicate they're in the zip64 field, and the zip64
    // values are zeroed to indicate they're in the data descriptor, and in this
    // case the data descriptor values will be 64-bit
    const field = new Zip64ExtraField();
    field.setValues({
      compressedSize: hasDataDescriptor ? 0 : entry.compressedSize,
      uncompressedSize: hasDataDescriptor ? 0 : entry.uncompressedSize,
    });

    zip64ExtraField = field.serialize();
  }

  let sizeMask: number | undefined;
  if (zip64) {
    // this means look in the zip64 field for size
    sizeMask = 0xffff_ffff;
  } else if (hasDataDescriptor) {
    // this means look in the data descriptor for size
    // - but if zip64, then that takes precedence and the values in the zip64
    // field are then zeroed, and the data descriptor becomes 64-bit
    sizeMask = 0;
  }

  const extraFieldLength =
    (entry.extraField?.byteLength ?? 0) + (zip64ExtraField?.byteLength ?? 0);

  const buffer = BufferView.alloc(
    30 + entry.path.byteLength + extraFieldLength,
  );

  buffer.writeUint32LE(LocalHeaderSignature, 0);
  buffer.writeUint16LE(entry.versionNeeded, 4);
  buffer.writeUint16LE(entry.flags.value, 6);
  buffer.writeUint16LE(entry.compressionMethod, 8);
  buffer.writeUint32LE(new DosDate(entry.lastModified).getDosDateTime(), 10);
  buffer.writeUint32LE(hasDataDescriptor ? 0 : entry.crc32, 14);
  buffer.writeUint32LE(sizeMask ?? entry.compressedSize, 18);
  buffer.writeUint32LE(sizeMask ?? entry.uncompressedSize, 22);
  buffer.writeUint16LE(entry.path.byteLength, 26);
  buffer.writeUint16LE(extraFieldLength, 28);

  let offset = 30;

  buffer.setBytes(offset, entry.path);
  offset += entry.path.byteLength;

  if (entry.extraField) {
    buffer.setBytes(offset, entry.extraField);
    offset += entry.extraField.byteLength;
  }
  if (zip64ExtraField) {
    buffer.setBytes(offset, zip64ExtraField);
    offset += zip64ExtraField.byteLength;
  }

  return buffer.getOriginalBytes();
}

export function writeDataDescriptor32(entry: DataDescriptor): Uint8Array {
  // 32-bit Data Descriptor (4.3.9)
  //
  // | offset | field                  | size |
  // | ------ | ---------------------- | ---- |
  // | 0      | signature (0x08074b50) | 4    |
  // | 4      | crc-32                 | 4    |
  // | 8      | compressed size        | 4    |
  // | 12     | uncompressed size      | 4    |
  // | 16     | (end)                  |      |
  const buffer = BufferView.alloc(16);

  buffer.writeUint32LE(DataDescriptorSignature, 0);
  buffer.writeUint32LE(entry.crc32, 4);
  buffer.writeUint32LE(entry.compressedSize, 8);
  buffer.writeUint32LE(entry.uncompressedSize, 12);

  return buffer.getOriginalBytes();
}

export function writeDataDescriptor64(entry: DataDescriptor): Uint8Array {
  // 64-bit Data Descriptor (4.3.9)
  //
  // | offset | field                  | size |
  // | ------ | ---------------------- | ---- |
  // | 0      | signature (0x08074b50) | 4    |
  // | 4      | crc-32                 | 4    |
  // | 8      | compressed size        | 8    |
  // | 16     | uncompressed size      | 8    |
  // | 24     | (end)                  |      |
  const buffer = BufferView.alloc(24);

  buffer.writeUint32LE(DataDescriptorSignature, 0);
  buffer.writeUint32LE(entry.crc32, 4);
  buffer.writeUint64LE(entry.compressedSize, 8);
  buffer.writeUint64LE(entry.uncompressedSize, 16);

  return buffer.getOriginalBytes();
}
