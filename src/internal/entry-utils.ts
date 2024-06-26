import type { DataDescriptor } from "./compression-core.js";
import { ZipVersion } from "./constants.js";
import { canBeCodePage437Encoded } from "./cp437.js";
import type {
  Zip64ExtraField,
  ZipEntryInfo,
  ZipEntryOptions,
} from "./records.js";

export function minimumVersion(
  options: ZipEntryOptions,
  requestedVersion?: ZipVersion,
): ZipVersion {
  const minRequired = Math.max(
    requestedVersion ?? ZipVersion.Deflate,
    options.utf8 ? ZipVersion.Utf8Encoding : ZipVersion.Deflate,
    options.zip64 ? ZipVersion.Zip64 : ZipVersion.Deflate,
  ) as ZipVersion;

  if (requestedVersion !== undefined && requestedVersion < minRequired) {
    throw new Error(
      `versionMadeBy is explicitly set but is lower than the required value`,
    );
  }

  return minRequired;
}

export function needs64bit(
  entry: Partial<Zip64ExtraField> & ZipEntryOptions,
): boolean {
  const value =
    !!entry.zip64 ||
    (entry.compressedSize ?? 0) > 0xffff_ffff ||
    (entry.uncompressedSize ?? 0) > 0xffff_ffff ||
    (entry.localHeaderOffset ?? 0) > 0xffff_ffff;

  if (entry.zip64 === false && value) {
    throw new Error(
      `zip64 is explicitly false but the entry sizes are bigger than 32 bit`,
    );
  }
  return value;
}

export function needsDataDescriptor(values: Partial<DataDescriptor>): boolean {
  return (
    values.compressedSize === undefined ||
    values.crc32 === undefined ||
    values.uncompressedSize === undefined
  );
}

export function needsUtf8(entry: ZipEntryInfo): boolean {
  const value =
    !!entry.utf8 ||
    (!!entry.comment && !canBeCodePage437Encoded(entry.comment)) ||
    (!!entry.path && !canBeCodePage437Encoded(entry.path));
  if (entry.utf8 === false && value) {
    throw new Error(
      `utf8 is explicitly false but the path or comment requires utf8 encoding`,
    );
  }
  return value;
}
