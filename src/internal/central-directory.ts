import {
  MultiDiskError,
  ZipFormatError,
  ZipSignatureError,
} from "../common.js";
import { assert } from "./assert.js";
import { BufferView, type BufferLike } from "./binary.js";
import {
  EndOfCentralDirectorySignature,
  Zip64EocdlSignature,
  Zip64EocdrSignature,
} from "./signatures.js";

export type CentralDirectory = {
  comment: string;
  count: number;
  offset: number;
  size: number;
};

export type CentralDirectoryResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      eocdr64Offset: number;
      byteLength: number;
    };

export function readEocdr(
  directory: CentralDirectory,
  inputBuffer: BufferLike,
  fileOffset = 0,
): CentralDirectoryResult {
  const view = new BufferView(inputBuffer);
  const minLength = 22;
  // max comment length is 0xffff
  const maxLength = Math.min(view.byteLength, minLength + 0xffff);

  let eocdrOffset: number | undefined;

  // look backwards from end of buffer for EOCDR signature
  for (
    let offset = view.byteLength - minLength;
    offset >= view.byteLength - maxLength;
    --offset
  ) {
    if (view.readUint32LE(offset) === EndOfCentralDirectorySignature) {
      eocdrOffset = offset;
      break;
    }
  }

  if (eocdrOffset === undefined) {
    throw new ZipFormatError(`unable to find end of central directory record`);
  }

  // | offset | field                         | size |
  // | ------ | ----------------------------- | ---- |
  // | 0      | signature (0x06054b50)        | 4    |
  // | 4      | number of this disk           | 2    |
  // | 6      | central directory start disk  | 2    |
  // | 8      | total entries this disk       | 2    |
  // | 10     | total entries on all disks    | 2    |
  // | 12     | size of the central directory | 4    |
  // | 16     | central directory offset      | 4    |
  // | 20     | .ZIP file comment length      | 2    |
  // | 22     | (end)                         |      |
  const commentLength = view.readUint16LE(eocdrOffset + 20);

  directory.comment = new TextDecoder().decode(
    view.getOriginalBytes(eocdrOffset + 22, commentLength),
  );

  // EOCDL starts 20 bytes before EOCDR
  const eocdlBufferOffset = eocdrOffset - 20;
  const eocdlFileOffset = eocdlBufferOffset + fileOffset;

  // we need to either have the EOCDL in the buffer, or the case where the EOCDL
  // wouldn't fit in the file
  assert(
    eocdlBufferOffset >= 0 || eocdlFileOffset < 0,
    `buffer must be at least as big as the EOCDR and possible EOCDL`,
  );

  if (
    eocdlBufferOffset >= 0 &&
    view.readUint32LE(eocdlBufferOffset) === Zip64EocdlSignature
  ) {
    // Zip64 End of Central Directory Locator (4.3.15)
    //
    // | offset | field                        | size |
    // | ------ | ---------------------------- | ---- |
    // | 0      | signature (0x07064b50)       | 4    |
    // | 4      | central directory start disk | 4    |
    // | 8      | central directory offset     | 8    |
    // | 16     | total number of disks        | 4    |
    // | 20     | (end)                        |      |
    const startDisk = view.readUint32LE(eocdlBufferOffset + 4);
    const totalDisks = view.readUint32LE(eocdlBufferOffset + 16);

    if (startDisk > 0 || totalDisks > 1) {
      throw new MultiDiskError();
    }

    const eocdr64Offset = view.readUint32LE(eocdlBufferOffset + 8);
    if (eocdr64Offset < fileOffset) {
      // zip64 eocdr is 56 bytes long
      return { ok: false, eocdr64Offset, byteLength: 56 };
    }

    // get the buffer-relative rather than file-relative offset
    readZip64Eocdr(directory, view, eocdr64Offset - fileOffset);
    return { ok: true };
  }

  // End of Central Directory Record (4.3.16)
  //
  // | offset | field                         | size |
  // | ------ | ----------------------------- | ---- |
  // | 0      | signature (0x06054b50)        | 4    |
  // | 4      | number of this disk           | 2    |
  // | 6      | central directory start disk  | 2    |
  // | 8      | total entries this disk       | 2    |
  // | 10     | total entries on all disks    | 2    |
  // | 12     | size of the central directory | 4    |
  // | 16     | central directory offset      | 4    |
  // | 20     | .ZIP file comment length      | 2    |
  // | 22     | (end)                         |      |
  directory.count = view.readUint16LE(eocdrOffset + 10);
  directory.size = view.readUint32LE(eocdrOffset + 12);
  directory.offset = view.readUint32LE(eocdrOffset + 16);

  const diskNumber = view.readUint16LE(eocdrOffset + 4);
  const totalEntriesThisDisk = view.readUint16LE(eocdrOffset + 8);

  if (diskNumber > 0 || totalEntriesThisDisk !== directory.count) {
    throw new MultiDiskError();
  }
  return { ok: true };
}

export function readZip64Eocdr(
  directory: CentralDirectory,
  buffer: BufferLike,
  bufferOffset: number,
): void {
  // Zip64 End of Central Directory Record (4.3.14)
  //
  // | offset | field                         | size |
  // | ------ | ----------------------------- | ---- |
  // | 0      | signature (0x06064b50)        | 4    |
  // | 4      | record size                   | 8    |
  // | 12     | version made by               | 2    |
  // | 14     | version needed to extract     | 2    |
  // | 16     | number of this disk           | 4    |
  // | 20     | central directory start disk  | 4    |
  // | 24     | total entries this disk       | 8    |
  // | 32     | total entries on all disks    | 8    |
  // | 40     | size of the central directory | 8    |
  // | 48     | central directory offset      | 8    |
  // | 56     | (end)                         |      |

  const view = new BufferView(buffer, bufferOffset);
  const signature = view.readUint32LE(0);

  if (signature !== Zip64EocdrSignature) {
    throw new ZipSignatureError("Zip64 EOCDR", signature);
  }

  directory.count = view.readUint64LE(32);
  directory.size = view.readUint64LE(40);
  directory.offset = view.readUint64LE(48);
}
