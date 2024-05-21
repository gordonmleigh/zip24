import { assert } from "./internal/assert.js";
import { BitField } from "./internal/binary.js";

export enum MadeByPlatform {
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
  NTFS = 10,
  Darwin = 19,
}

export enum ZipVersion {
  Deflate = 20,
  Deflate64 = 21,
  Zip64 = 45,
}

export class GeneralPurposeFlags extends BitField {
  public constructor(value = 0) {
    // default is to enable utf-8
    super(value, 16);
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
  public static fromDateTime(dateValue: number, timeValue: number): DosDate {
    const date = new DosDate();
    date.setDosDate(dateValue);
    date.setDosTime(timeValue);
    return date;
  }

  /**
   * Create a new instance from the given date/time value. The value is a 32-bit
   * integer with the time in the lower 16 bits and date in the upper 16 bits.
   */
  public static fromDosDateTime(dateTime: number): DosDate {
    const date = new DosDate();
    date.setDosDateTime(dateTime);
    return date;
  }

  /**
   * Get the date represented as a DOS-formatted value. The value is a 32-bit
   * integer with the time in the lower 16 bits and date in the upper 16 bits.
   */
  public getDosDateTime(): number {
    return ((this.getDosDate() << 16) >>> 0) | this.getDosTime();
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
    // little-endian, so first word is low-order word
    this.setDosTime(value & 0xffff);
    // no need to mask because >>> is only defined for 32 bit
    this.setDosDate(value >>> 16);

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
    return day | (month << 5) | (year << 9);
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
    this.setMonth(((value >> 5) & 0xf) - 1); // 1-12
    this.setFullYear(((value >> 9) & 0x7f) + 1980); // 0-128, 1980-2108

    return this.getTime();
  }

  /**
   * Get the DOS-formatted time.
   */
  public getDosTime(): number {
    const second = Math.round(this.getSeconds() / 2);
    const minute = this.getMinutes();
    const hour = this.getHours();
    return second | (minute << 5) | (hour << 11);
  }

  /**
   * Set the DOS-formatted time.
   */
  public setDosTime(value: number): number {
    assert(
      Number.isInteger(value) && value >= 0 && value <= 0xffff,
      `invalid value for dos value ${value}`,
    );

    this.setSeconds((value & 0x1f) * 2); // 0-29, 0-58 (even numbers)
    this.setMinutes((value >> 5) & 0x3f); // 0-59
    this.setHours((value >> 11) & 0x1f); // 0-23

    return this.getTime();
  }
}

/**
 * Represents an object which can read a zip file.
 */
export type ZipReaderLike = {
  readonly fileCount: number;
  readonly comment: string;

  readonly files: () => AsyncIterable<ZipEntryReaderLike>;
} & AsyncIterable<ZipEntryReaderLike>;

/**
 * Represents an object which can read a zip file entry.
 */
export type ZipEntryReaderLike = {
  readonly comment: string;
  readonly compressedSize: number;
  readonly crc32: number;
  readonly path: string;
  readonly uncompressedSize: number;

  readonly getBuffer: () => PromiseLike<Uint8Array>;
  readonly getData: () => AsyncIterable<Uint8Array>;
} & AsyncIterable<Uint8Array>;

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
