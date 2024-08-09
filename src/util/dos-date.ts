import { assert } from "./assert.js";

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
      Number.isInteger(value) && value >= 0 && value <= 4294967295,
      `invalid value for dos date/time ${value}`,
    );
    // no need to mask because >>> is only defined for 32 bit
    this.setDosDate(value >>> 16);
    // little-endian, so first word is low-order word
    this.setDosTime(value & 65535);

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
      Number.isInteger(value) && value >= 0 && value <= 65535,
      `invalid value for dos date ${value}`,
    );

    this.setDate(value & 31); // 1-31
    this.setMonth(((value >>> 5) & 15) - 1); // 1-12
    this.setFullYear(((value >>> 9) & 127) + 1980); // 0-128, 1980-2108

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
      Number.isInteger(value) && value >= 0 && value <= 65535,
      `invalid value for dos time ${value}`,
    );

    this.setSeconds((value & 31) * 2); // 0-29, 0-58 (even numbers)
    this.setMinutes((value >>> 5) & 63); // 0-59
    this.setHours((value >>> 11) & 31); // 0-23

    return this.getTime();
  }
}
