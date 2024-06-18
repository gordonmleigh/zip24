import { BufferView, type BufferLike } from "./binary.js";
import { ZipSignatureError } from "./errors.js";
import { LocalHeaderSignature } from "./signatures.js";

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
