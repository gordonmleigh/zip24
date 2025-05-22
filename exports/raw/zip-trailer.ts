import { BufferView, type BufferLike } from "../../util/binary.ts";
import { CodePage437Encoder } from "../../util/cp437.ts";
import { makeBuffer, type Serializable } from "../../util/serialization.ts";
import {
  MultiDiskError,
  ZipFormatError,
  ZipSignatureError,
} from "../errors.ts";
import { ZipPlatform, ZipVersion } from "./constants.ts";

export type EocdrFields = {
  comment: string;
  directoryLength: number;
  directoryStart: number;
  entryCount: number;
};

export class Eocdr implements EocdrFields, Serializable {
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

  public static readonly MinLength = 22;
  // fixed size + max extra field + max comment
  public static readonly MaxLength = this.MinLength + 2 * 0xffff;
  public static readonly Signature = 0x06054b50;

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Eocdr {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("end of central directory record", signature);
    }

    const diskNumber = view.readUint16LE(4);
    const startDisk = view.readUint16LE(6);
    const count = view.readUint16LE(8);
    const totalEntriesAllDisks = view.readUint16LE(10);
    const size = view.readUint32LE(12);
    const offset = view.readUint32LE(16);
    const commentLength = view.readUint16LE(20);
    const comment = view.readString("cp437", 22, commentLength);

    if (
      (diskNumber !== 0 && diskNumber !== 0xffff) ||
      (startDisk !== 0 && startDisk !== 0xffff) ||
      totalEntriesAllDisks !== count
    ) {
      throw new MultiDiskError();
    }

    return new this({
      comment,
      directoryLength: size,
      directoryStart: offset,
      entryCount: count,
    });
  }

  public static findOffset(buffer: BufferLike): number {
    const view = new BufferView(buffer);

    // max comment length is 0xffff
    const maxLength = Math.min(view.byteLength, this.MinLength + 0xffff);
    const lastOffset = view.byteLength - this.MinLength;
    const firstOffset = view.byteLength - maxLength;

    // look backwards from end of buffer for EOCDR signature
    for (let offset = lastOffset; offset >= firstOffset; --offset) {
      if (view.readUint32LE(offset) === this.Signature) {
        return offset;
      }
    }
    throw new ZipFormatError(`unable to find end of central directory record`);
  }

  public comment = "";
  public directoryLength = 0;
  public directoryStart = 0;
  public entryCount = 0;
  public zip64 = false;

  public constructor(fields?: EocdrFields, zip64 = false) {
    if (fields) {
      this.comment = fields.comment;
      this.directoryLength = fields.directoryLength;
      this.directoryStart = fields.directoryStart;
      this.entryCount = fields.entryCount;
    }
    this.zip64 = zip64;
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const rawComment = new CodePage437Encoder().encode(this.comment);

    const view = makeBuffer(
      22 + rawComment.byteLength,
      buffer,
      byteOffset,
      byteLength,
    );

    view.writeUint32LE(Eocdr.Signature, 0); // signature
    view.writeUint16LE(this.zip64 ? 0xffff : 0, 4); // number of this disk
    view.writeUint16LE(this.zip64 ? 0xffff : 0, 6); // central directory start disk
    view.writeUint16LE(this.zip64 ? 0xffff : this.entryCount, 8); // total entries this disk
    view.writeUint16LE(this.zip64 ? 0xffff : this.entryCount, 10); // total entries all disks
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.directoryLength, 12); // size of the central directory
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.directoryStart, 16); // central directory offset
    view.writeUint16LE(rawComment.byteLength, 20); // .ZIP file comment length
    view.setBytes(22, rawComment); // .ZIP file comment

    return view.getOriginalBytes();
  }
}

export class Zip64Eocdl implements Serializable {
  // Zip64 End of Central Directory Locator (4.3.15)
  //
  // | offset | field                        | size |
  // | ------ | ---------------------------- | ---- |
  // | 0      | signature (0x07064b50)       | 4    |
  // | 4      | start disk of Zip64 EOCDR    | 4    |
  // | 8      | offset of Zip64 EOCDR        | 8    |
  // | 16     | total number of disks        | 4    |
  // | 20     | (end)                        |      |

  public static readonly RecordLength = 20;
  public static readonly Signature = 0x07064b50;

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Zip64Eocdl {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("Zip64 EOCDL", signature);
    }

    const startDisk = view.readUint32LE(4);
    const eocdrOffset = view.readUint64LE(8);
    const totalDisks = view.readUint32LE(16);

    if (startDisk > 0 || totalDisks > 1) {
      throw new MultiDiskError();
    }

    return new this(eocdrOffset);
  }

  public static find(
    buffer: BufferLike,
    eocdrOffset: number,
  ): Zip64Eocdl | undefined {
    const offset = eocdrOffset - this.RecordLength;
    if (offset < 0) {
      return;
    }

    const view = new BufferView(buffer, offset);
    if (view.readUint32LE(0) === this.Signature) {
      return Zip64Eocdl.deserialize(buffer, offset);
    }
  }

  public eocdrOffset: number;

  public constructor(eocdrOffset = 0) {
    this.eocdrOffset = eocdrOffset;
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const view = makeBuffer(20, buffer, byteOffset, byteLength);

    view.writeUint32LE(Zip64Eocdl.Signature, 0);
    view.writeUint32LE(0, 4);
    view.writeUint64LE(this.eocdrOffset, 8);
    view.writeUint32LE(1, 16);

    return view.getOriginalBytes();
  }
}

export type Zip64EocdrFields = {
  directoryLength: number;
  directoryStart: number;
  entryCount: number;
  platformMadeBy: number;
  versionMadeBy: number;
  versionNeeded: number;
};

export class Zip64Eocdr implements Zip64EocdrFields, Serializable {
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
  // | 56     | extensible data sector        | ...  |
  // | ...    | (56 + record size - 12)       |      |

  public static readonly MinLength = 56;
  public static readonly Signature = 0x06064b50;

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Zip64Eocdr {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("Zip64 EOCDR", signature);
    }

    const versionMadeBy = view.readUint8(12);
    const platformMadeBy = view.readUint8(13);
    const versionNeeded = view.readUint16LE(14);
    const count = view.readUint64LE(24);
    const size = view.readUint64LE(40);
    const offset = view.readUint64LE(48);

    return new this({
      directoryStart: offset,
      directoryLength: size,
      entryCount: count,
      platformMadeBy,
      versionMadeBy,
      versionNeeded,
    });
  }

  public directoryLength = 0;
  public directoryStart = 0;
  public entryCount = 0;
  public platformMadeBy: number = ZipPlatform.DOS;
  public versionMadeBy: number = ZipVersion.Zip64;
  public versionNeeded: number = ZipVersion.Zip64;

  public constructor(fields?: Zip64EocdrFields) {
    if (fields) {
      this.directoryLength = fields.directoryLength;
      this.directoryStart = fields.directoryStart;
      this.entryCount = fields.entryCount;
      this.platformMadeBy = fields.platformMadeBy;
      this.versionMadeBy = fields.versionMadeBy;
      this.versionNeeded = fields.versionNeeded;
    }
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const view = makeBuffer(56, buffer, byteOffset, byteLength);

    view.writeUint32LE(Zip64Eocdr.Signature, 0); // signature
    view.writeUint64LE(56 - 12, 4); // record size: should not include first 12 bytes
    view.writeUint8(this.versionMadeBy, 12); // version made by
    view.writeUint8(this.platformMadeBy, 13); // platform made by
    view.writeUint16LE(this.versionNeeded, 14); // version needed
    view.writeUint32LE(0, 16); // number of this disk
    view.writeUint32LE(0, 20); // central directory start disk
    view.writeUint64LE(this.entryCount, 24); // total entries this disk
    view.writeUint64LE(this.entryCount, 32); // total entries all disks
    view.writeUint64LE(this.directoryLength, 40); // size of the central directory
    view.writeUint64LE(this.directoryStart, 48); // central directory offset

    return view.getOriginalBytes();
  }
}

export type Zip64VersionFields = {
  platformMadeBy: number;
  versionMadeBy: number;
  versionNeeded: number;
};

export type ZipTrailerFields = {
  comment: string;
  directoryLength: number;
  directoryStart: number;
  entryCount: number;
  zip64?: Zip64VersionFields | undefined;
};

export class ZipTrailer implements ZipTrailerFields {
  public comment: string;
  public directoryLength: number;
  public directoryStart: number;
  public entryCount: number;
  public zip64: Zip64VersionFields | undefined;

  public constructor(eocdr: EocdrFields, eocdr64?: Zip64EocdrFields) {
    this.comment = eocdr.comment;
    this.entryCount = eocdr64?.entryCount ?? eocdr.entryCount;
    this.directoryStart = eocdr64?.directoryStart ?? eocdr.directoryStart;
    this.directoryLength = eocdr64?.directoryLength ?? eocdr.directoryLength;
    this.zip64 = eocdr64;
  }
}
