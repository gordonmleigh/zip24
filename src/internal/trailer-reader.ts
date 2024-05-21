import { assert } from "./assert.js";
import { BufferView, type BufferLike } from "./binary.js";
import {
  EndOfCentralDirectorySignature,
  Zip64EocdlSignature,
} from "./signatures.js";

export type EocdrResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      eocdr64Offset: number;
      byteLength: number;
    };

export class ZipTrailerReader {
  public centralDirectoryEntries = 0;
  public centralDirectoryOffset = 0;
  public centralDirectorySize = 0;
  public fileComment = "";
  public isOpen = false;

  public readEocdr(buffer: BufferLike, fileOffset = 0): EocdrResult {
    const view = new BufferView(buffer);
    const minLength = 22;
    // max comment length is 0xffff
    const maxLength = Math.min(buffer.byteLength, minLength + 0xffff);

    let eocdrOffset: number | undefined;

    // look backwards from end of buffer for EOCDR signature
    for (
      let offset = buffer.byteLength - minLength;
      offset >= buffer.byteLength - maxLength;
      --offset
    ) {
      if (view.readUint32LE(offset) === EndOfCentralDirectorySignature) {
        eocdrOffset = offset;
        break;
      }
    }

    assert(
      eocdrOffset !== undefined,
      `unable to find end of central directory record`,
    );

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

    this.fileComment = new TextDecoder().decode(
      view.getOriginalBytes(eocdrOffset + 22, commentLength),
    );

    // EOCDL starts 20 bytes before EOCDR
    const eocdlOffset = eocdrOffset - 20;

    if (view.readUint32LE(eocdlOffset) === Zip64EocdlSignature) {
      // Zip64 End of Central Directory Locator (4.3.15)
      //
      // | offset | field                        | size |
      // | ------ | ---------------------------- | ---- |
      // | 0      | signature (0x07064b50)       | 4    |
      // | 4      | central directory start disk | 4    |
      // | 8      | central directory offset     | 8    |
      // | 16     | total number of disks        | 4    |
      // | 20     | (end)                        |      |
      const startDisk = view.readUint32LE(eocdlOffset + 4);
      const totalDisks = view.readUint32LE(eocdlOffset + 16);

      assert(
        startDisk === 0 && totalDisks === 1,
        `multi-disk zips not supported`,
      );

      const eocdr64Offset = view.readUint32LE(eocdlOffset + 8);
      if (eocdrOffset < fileOffset) {
        // zip64 eocdr is 56 bytes long
        this.isOpen = false;
        return { ok: false, eocdr64Offset, byteLength: 56 };
      }

      // get the buffer-relative rather than file-relative offset
      this.readZip64Eocdr(buffer, eocdr64Offset - fileOffset);
      this.isOpen = true;
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
    this.centralDirectoryEntries = view.readUint16LE(eocdrOffset + 10);
    this.centralDirectorySize = view.readUint32LE(eocdrOffset + 12);
    this.centralDirectoryOffset = view.readUint32LE(eocdrOffset + 16);

    const diskNumber = view.readUint16LE(eocdrOffset + 4);
    const totalEntriesThisDisk = view.readUint16LE(eocdrOffset + 8);

    assert(
      diskNumber === 0 && totalEntriesThisDisk === this.centralDirectoryEntries,
      `multi-file zips are not supported`,
    );
    this.isOpen = true;
    return { ok: true };
  }

  public readZip64Eocdr(buffer: BufferLike, bufferOffset = 0): void {
    const view = new BufferView(buffer, bufferOffset);
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
    this.centralDirectoryEntries = view.readUint64LE(32);
    this.centralDirectorySize = view.readUint64LE(40);
    this.centralDirectoryOffset = view.readUint64LE(48);

    const diskNumber = view.readUint32LE(16);
    const totalEntriesThisDisk = view.readUint64LE(24);

    assert(
      diskNumber === 0 && totalEntriesThisDisk === this.centralDirectoryEntries,
      `multi-file zips are not supported`,
    );

    this.isOpen = true;
  }
}
