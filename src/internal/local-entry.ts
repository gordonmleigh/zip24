import { BufferView, type BufferLike } from "./binary.js";
import { ZipSignatureError } from "./errors.js";
import { writeZip64ExtraField } from "./extra-fields.js";
import { DosDate } from "./field-types.js";
import type { RawLocalHeader } from "./records.js";
import { LocalHeaderSignature } from "./signatures.js";

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
  const hasDataDescriptor = entry.flags.hasDataDescriptor;
  const zip64 = !!options?.zip64;

  let extraField: Uint8Array;
  if (zip64) {
    // if there's a data descriptor _and_ zip64, then the header values are
    // set to ffffffff to indicate they're in the zip64 field, and the zip64
    // values are zeroed to indicate they're in the data descriptor, and in this
    // case the data descriptor values will be 64-bit
    const zip64ExtraField = writeZip64ExtraField({
      compressedSize: hasDataDescriptor ? 0 : entry.compressedSize,
      uncompressedSize: hasDataDescriptor ? 0 : entry.uncompressedSize,
    });
    if (entry.extraField) {
      extraField = new Uint8Array(
        entry.extraField.length + zip64ExtraField.length,
      );
      extraField.set(entry.extraField);
      extraField.set(zip64ExtraField, entry.extraField.length);
    } else {
      extraField = zip64ExtraField;
    }
  } else {
    extraField = entry.extraField ?? new Uint8Array(0);
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

  const buffer = BufferView.alloc(
    30 + entry.path.byteLength + extraField.byteLength,
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
  buffer.writeUint16LE(extraField.byteLength, 28);
  buffer.setBytes(30, entry.path);
  buffer.setBytes(30 + entry.path.byteLength, extraField);

  return buffer.getOriginalBytes();
}
