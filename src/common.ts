import { assert } from "./internal/assert.js";
import { BitField } from "./internal/binary.js";

export enum ZipPlatform {
  // 4.4.2.2 The current mappings are:
  //   0 - MS-DOS and OS/2 (FAT / VFAT / FAT32 file systems)
  //   1 - Amiga                     2 - OpenVMS
  //   3 - UNIX                      4 - VM/CMS
  //   5 - Atari ST                  6 - OS/2 H.P.F.S.
  //   7 - Macintosh                 8 - Z-System
  //   9 - CP/M                     10 - Windows NTFS
  // 11 - MVS (OS/390 - Z/OS)      12 - VSE
  // 13 - Acorn Risc               14 - VFAT
  // 15 - alternate MVS            16 - BeOS
  // 17 - Tandem                   18 - OS/400
  // 19 - OS X (Darwin)            20 thru 255 - unused
  DOS = 0,
  UNIX = 3,
}

export enum ZipVersion {
  Deflate = 20,
  Zip64 = 45,
  UtfEncoding = 63,
}

export type CommonAttributes = {
  isReadOnly: boolean;
  isDirectory: boolean;
  isFile: boolean;
};

export class DosFileAttributes extends BitField implements CommonAttributes {
  // https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants
  public constructor(value = 0) {
    super(8, value);
  }

  public get isReadOnly(): boolean {
    return this.getBit(0);
  }
  public set isReadOnly(value: boolean) {
    this.setBit(0, value);
  }

  public get isHidden(): boolean {
    return this.getBit(1);
  }
  public set isHidden(value: boolean) {
    this.setBit(1, value);
  }

  public get isSystem(): boolean {
    return this.getBit(2);
  }
  public set isSystem(value: boolean) {
    this.setBit(2, value);
  }

  public get isDirectory(): boolean {
    return this.getBit(4);
  }
  public set isDirectory(value: boolean) {
    this.setBit(4, value);
  }

  public get isFile(): boolean {
    return !this.isDirectory;
  }
  public set isFile(value: boolean) {
    if (value) {
      this.isDirectory = false;
    } else {
      throw new RangeError(
        `unable to set isFile to false (set another type flag to true instead)`,
      );
    }
  }
}

export class UnixFileAttributes extends BitField implements CommonAttributes {
  // https://man7.org/linux/man-pages/man7/inode.7.html
  public constructor(value = 0) {
    super(16, value);
  }

  public get isDirectory(): boolean {
    return this.type === 0o4_0000;
  }
  public set isDirectory(value: boolean) {
    this.type = value ? 0o4_0000 : 0o10_0000;
  }

  public get isFile(): boolean {
    return this.type === 0o10_0000;
  }
  public set isFile(value: boolean) {
    if (value) {
      this.type = 0o10_0000;
    } else {
      throw new RangeError(
        `unable to set isFile to false (set another type flag to true instead)`,
      );
    }
  }

  public get isReadOnly(): boolean {
    // no-one has write permission set
    return (this.permissions & 0b010_010_010) === 0;
  }
  public set isReadOnly(value: boolean) {
    if (value) {
      // clear write permission for everyone
      this.permissions = this.permissions & 0b101_101_101;
    } else {
      // set write permission for everyone
      this.permissions = this.permissions | 0b010_010_010;
    }
  }

  public get isSymbolicLink(): boolean {
    return this.type === 0o12_0000;
  }
  public set isSymbolicLink(value: boolean) {
    this.type = value ? 0o12_0000 : 0o10_0000;
  }

  public get mode(): number {
    return this.value & 0o7777;
  }
  public set mode(value: number) {
    this.value = (this.value & 0o17_0000) | (value & 0o7777);
  }

  public get permissions(): number {
    return this.value & 0o777;
  }
  public set permissions(value: number) {
    this.value = (this.value & 0o177000) | (value & 0o777);
  }

  public get type(): number {
    return this.value & 0o170000;
  }
  public set type(value: number) {
    this.value = (this.value & 0o7777) | (value & 0o17_0000);
  }
}

export class GeneralPurposeFlags extends BitField {
  public constructor(value = 0) {
    super(16, value);
  }

  public get hasEncryption(): boolean {
    return this.getBit(0);
  }

  public get hasDataDescriptor(): boolean {
    return this.getBit(3);
  }
  public set hasDataDescriptor(value: boolean) {
    this.setBit(3, value);
  }

  public get hasStrongEncryption(): boolean {
    return this.getBit(6);
  }

  public get hasUtf8Strings(): boolean {
    return this.getBit(11);
  }
  public set hasUtf8Strings(value: boolean) {
    this.setBit(11, value);
  }
}

export enum CompressionMethod {
  Stored = 0,
  Deflate = 8,
}

export enum ExtendedDataTag {
  Unset = 0,
  Zip64ExtendedInfo = 0x01,
  UnicodeCommentField = 0x6375,
  UnicodePathField = 0x7075,
  Unix = 0x0d,
}

/**
 * An extension to the {@link Date} class to support DOS-encoded values.
 */
export class DosDate extends Date {
  /**
   * Create a new instance from the given date and time values. Each value
   * should be a 16-bit integer.
   */
  public static fromDosDateTime(dateValue: number, timeValue: number): DosDate {
    const date = new DosDate(0);
    date.setDosDate(dateValue);
    date.setDosTime(timeValue);
    return date;
  }

  /**
   * Create a new instance from the given date/time value. The value is a 32-bit
   * integer with the time in the lower 16 bits and date in the upper 16 bits.
   */
  public static fromDosUint32(dateTime: number): DosDate {
    const date = new DosDate(0);
    date.setDosDateTime(dateTime);
    return date;
  }

  /**
   * Get the date represented as a DOS-formatted value. The value is a 32-bit
   * integer with the time in the lower 16 bits and date in the upper 16 bits.
   */
  public getDosDateTime(): number {
    return ((this.getDosDate() << 16) | this.getDosTime()) >>> 0;
  }

  /**
   * Set the date/time value for this instance. The value is a 32-bit integer
   * with the time in the lower 16 bits and date in the upper 16 bits.
   */
  public setDosDateTime(value: number): number {
    assert(
      Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff,
      `invalid value for dos date/time ${value}`,
    );
    // no need to mask because >>> is only defined for 32 bit
    this.setDosDate(value >>> 16);
    // little-endian, so first word is low-order word
    this.setDosTime(value & 0xffff);

    return this.getTime();
  }

  /**
   * Get the DOS-formatted date.
   */
  public getDosDate(): number {
    const day = this.getDate();
    const month = this.getMonth() + 1;
    // clamp at 1980 which is the earliest representable date
    // (1970 for regular Date class)
    const year = Math.max(0, this.getFullYear() - 1980);
    return (day | (month << 5) | (year << 9)) >>> 0;
  }

  /**
   * Set the DOS-formatted date.
   */
  public setDosDate(value: number): number {
    assert(
      Number.isInteger(value) && value >= 0 && value <= 0xffff,
      `invalid value for dos date ${value}`,
    );

    this.setDate(value & 0x1f); // 1-31
    this.setMonth(((value >>> 5) & 0xf) - 1); // 1-12
    this.setFullYear(((value >>> 9) & 0x7f) + 1980); // 0-128, 1980-2108

    return this.getTime();
  }

  /**
   * Get the DOS-formatted time.
   */
  public getDosTime(): number {
    const second = Math.round(this.getSeconds() / 2);
    const minute = this.getMinutes();
    const hour = this.getHours();
    return (second | (minute << 5) | (hour << 11)) >>> 0;
  }

  /**
   * Set the DOS-formatted time.
   */
  public setDosTime(value: number): number {
    assert(
      Number.isInteger(value) && value >= 0 && value <= 0xffff,
      `invalid value for dos time ${value}`,
    );

    this.setSeconds((value & 0x1f) * 2); // 0-29, 0-58 (even numbers)
    this.setMinutes((value >>> 5) & 0x3f); // 0-59
    this.setHours((value >>> 11) & 0x1f); // 0-23

    return this.getTime();
  }
}

/**
 * A function which can transform data from an async iterable.
 */
export type AsyncTransform = (
  input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
) => AsyncIterable<Uint8Array>;

/**
 * A map of compression methods to compression/decompression algorithms.
 */
export type CompressionAlgorithms = Partial<
  Record<CompressionMethod, AsyncTransform>
>;

export class ZipError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

export class MultiDiskError extends ZipError {
  public constructor() {
    super(`multi-disk zips not supported`, "E_ZIP_MULTI_DISK");
    this.name = "MultiDiskError";
  }
}

export class ZipFormatError extends ZipError {
  public constructor(message: string) {
    super(message, "E_ZIP_FORMAT");
    this.name = "ZipFormatError";
  }
}

export class ZipSignatureError extends ZipFormatError {
  public constructor(recordName: string, actual: number) {
    super(`invalid signature for ${recordName} (${actual.toString(16)})`);
    this.name = "ZipSignatureError";
  }
}
