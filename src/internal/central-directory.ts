import { hasProperty } from "../util/assert.js";
import { BufferView, type BufferLike } from "../util/binary.js";
import { CodePage437Decoder, CodePage437Encoder } from "../util/cp437.js";
import { MultiDiskError, ZipFormatError, ZipSignatureError } from "./errors.js";
import type { CentralDirectory, CentralDirectory64 } from "./records.js";
import {
  EndOfCentralDirectoryLength,
  EndOfCentralDirectorySignature,
  Zip64EocdlLength,
  Zip64EocdlSignature,
  Zip64EocdrLength,
  Zip64EocdrSignature,
} from "./signatures.js";

export type CentralDirectoryResult =
  | {
      ok: true;
      directory: CentralDirectory;
    }
  | {
      ok: false;
      directory: CentralDirectory;
      eocdr64Offset: number;
    };

export type EocdrLocator = {
  eocdrOffset: number;
  eocdr64Offset?: number;
};

export function readZipTrailer(
  buffer: BufferLike,
  fileOffset = 0,
): CentralDirectoryResult {
  const { eocdrOffset, eocdr64Offset } = locateEocdr(buffer, fileOffset);
  const directory = readEocdr(buffer, eocdrOffset - fileOffset);

  if (eocdr64Offset !== undefined) {
    if (eocdr64Offset < fileOffset) {
      // the eocdr64offset is outside the buffer
      return {
        ok: false,
        directory,
        eocdr64Offset,
      };
    }

    readZip64Eocdr(directory, buffer, eocdr64Offset - fileOffset);
  }

  return { ok: true, directory };
}

export function locateEocdr(
  buffer: BufferLike,
  fileOffset: number,
): EocdrLocator {
  const view = new BufferView(buffer);

  // max comment length is 0xffff
  const maxLength = Math.min(
    view.byteLength,
    EndOfCentralDirectoryLength + 0xffff,
  );
  const lastOffset = view.byteLength - EndOfCentralDirectoryLength;
  const firstOffset = view.byteLength - maxLength;

  // look backwards from end of buffer for EOCDR signature
  for (let offset = lastOffset; offset >= firstOffset; --offset) {
    if (view.readUint32LE(offset) !== EndOfCentralDirectorySignature) {
      continue;
    }

    const eocdrOffset = fileOffset + offset;
    const eocdlBufferOffset = offset - Zip64EocdlLength;

    if (eocdlBufferOffset >= 0) {
      // check for the EOCDL and return it if found
      if (view.readUint32LE(eocdlBufferOffset) === Zip64EocdlSignature) {
        return {
          eocdrOffset,
          eocdr64Offset: readEocdl(buffer, eocdlBufferOffset),
        };
      }
    } else if (fileOffset + eocdlBufferOffset >= 0) {
      // not sure what format the zip is in because the buffer isn't big enough.
      // we check the fileOffset is +ve so we can read empty zips (only EOCDR)
      throw new Error(
        `buffer must be at least as big as the EOCDR and possible EOCDL`,
      );
    }

    return { eocdrOffset };
  }

  throw new ZipFormatError(`unable to find end of central directory record`);
}

export function readEocdr(
  buffer: BufferLike,
  bufferOffset = 0,
): CentralDirectory {
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

  const view = new BufferView(buffer, bufferOffset);
  const signature = view.readUint32LE(0);

  if (signature !== EndOfCentralDirectorySignature) {
    throw new ZipSignatureError("end of central directory record", signature);
  }

  const diskNumber = view.readUint16LE(4);
  const startDisk = view.readUint16LE(6);
  const count = view.readUint16LE(8);
  const totalEntriesAllDisks = view.readUint16LE(10);
  const size = view.readUint32LE(12);
  const offset = view.readUint32LE(16);
  const commentLength = view.readUint16LE(20);

  const comment = new CodePage437Decoder().decode(
    view.getOriginalBytes(22, commentLength),
  );

  if (
    (diskNumber !== 0 && diskNumber !== 0xffff) ||
    (startDisk !== 0 && startDisk !== 0xffff) ||
    totalEntriesAllDisks !== count
  ) {
    throw new MultiDiskError();
  }

  return {
    comment,
    count,
    offset,
    size,
  };
}

export function readEocdl(buffer: BufferLike, bufferOffset = 0): number {
  // Zip64 End of Central Directory Locator (4.3.15)
  //
  // | offset | field                        | size |
  // | ------ | ---------------------------- | ---- |
  // | 0      | signature (0x07064b50)       | 4    |
  // | 4      | start disk of Zip64 EOCDR    | 4    |
  // | 8      | offset of Zip64 EOCDR        | 8    |
  // | 16     | total number of disks        | 4    |
  // | 20     | (end)                        |      |

  const view = new BufferView(buffer, bufferOffset);
  const signature = view.readUint32LE(0);

  if (signature !== Zip64EocdlSignature) {
    throw new ZipSignatureError("Zip64 EOCDL", signature);
  }

  const startDisk = view.readUint32LE(4);
  const eocdrOffset = view.readUint64LE(8);
  const totalDisks = view.readUint32LE(16);

  if (startDisk > 0 || totalDisks > 1) {
    throw new MultiDiskError();
  }

  return eocdrOffset;
}

export function readZip64Eocdr(
  directory: CentralDirectory,
  buffer: BufferLike,
  bufferOffset = 0,
): asserts directory is CentralDirectory64 {
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

  directory.zip64 = {
    versionMadeBy: view.readUint8(12),
    platformMadeBy: view.readUint8(13),
    versionNeeded: view.readUint16LE(14),
  };
  directory.count = view.readUint64LE(24);
  directory.size = view.readUint64LE(40);
  directory.offset = view.readUint64LE(48);
}

export function writeZipTrailer(
  directory: CentralDirectory,
  fileOffset: number,
): Uint8Array {
  let size = EndOfCentralDirectoryLength + directory.comment.length;
  if (directory.zip64) {
    size += Zip64EocdlLength + Zip64EocdrLength;
  }

  const buffer = new Uint8Array(size);
  let offset = 0;

  if (hasProperty(directory, "zip64")) {
    writeZip64Eocdr(directory, buffer, 0);
    offset += Zip64EocdrLength;
    writeEocdl(fileOffset, buffer, offset);
    offset += Zip64EocdlLength;
  }

  writeEocdr(directory, buffer, offset);
  return buffer;
}

export function writeEocdr(
  directory: CentralDirectory,
  buffer?: BufferLike,
  bufferOffset = 0,
): Uint8Array {
  const commentBytes = new CodePage437Encoder().encode(directory.comment);
  const recordLength = 22 + commentBytes.byteLength;
  const zip64 = !!directory.zip64;

  const view = buffer
    ? new BufferView(buffer, bufferOffset)
    : BufferView.alloc(bufferOffset + recordLength);

  view.writeUint32LE(EndOfCentralDirectorySignature, 0);
  view.writeUint16LE(zip64 ? 0xffff : 0, 4);
  view.writeUint16LE(zip64 ? 0xffff : 0, 6);
  view.writeUint16LE(zip64 ? 0xffff : directory.count, 8);
  view.writeUint16LE(zip64 ? 0xffff : directory.count, 10);
  view.writeUint32LE(zip64 ? 0xffff_ffff : directory.size, 12);
  view.writeUint32LE(zip64 ? 0xffff_ffff : directory.offset, 16);
  view.writeUint16LE(commentBytes.byteLength, 20);
  view.setBytes(22, commentBytes);

  return view.getOriginalBytes();
}

export function writeEocdl(
  eocdrOffset: number,
  buffer?: BufferLike,
  bufferOffset = 0,
): Uint8Array {
  // Zip64 End of Central Directory Locator (4.3.15)
  //
  // | offset | field                        | size |
  // | ------ | ---------------------------- | ---- |
  // | 0      | signature (0x07064b50)       | 4    |
  // | 4      | start disk of Zip64 EOCDR    | 4    |
  // | 8      | offset of Zip64 EOCDR        | 8    |
  // | 16     | total number of disks        | 4    |
  // | 20     | (end)                        |      |

  const view = buffer
    ? new BufferView(buffer, bufferOffset)
    : BufferView.alloc(bufferOffset + 20);

  view.writeUint32LE(Zip64EocdlSignature, 0);
  view.writeUint32LE(0, 4);
  view.writeUint64LE(eocdrOffset, 8);
  view.writeUint32LE(1, 16);

  return view.getOriginalBytes();
}

export function writeZip64Eocdr(
  directory: CentralDirectory64,
  buffer?: BufferLike,
  bufferOffset = 0,
): Uint8Array {
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

  const view = buffer
    ? new BufferView(buffer, bufferOffset)
    : BufferView.alloc(bufferOffset + 56);

  view.writeUint32LE(Zip64EocdrSignature, 0);
  view.writeUint64LE(56 - 12, 4); // should not include first 12 bytes
  view.writeUint8(directory.zip64.versionMadeBy, 12);
  view.writeUint8(directory.zip64.platformMadeBy, 13);
  view.writeUint16LE(directory.zip64.versionNeeded, 14);
  view.writeUint32LE(0, 16);
  view.writeUint32LE(0, 20);
  view.writeUint64LE(directory.count, 24);
  view.writeUint64LE(directory.count, 32);
  view.writeUint64LE(directory.size, 40);
  view.writeUint64LE(directory.offset, 48);

  return view.getOriginalBytes();
}
