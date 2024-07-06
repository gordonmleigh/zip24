import { canBeCodePage437Encoded } from "../util/cp437.js";
import { CompressionMethod } from "./compression-core.js";
import { ExtraFieldTag, ZipPlatform, ZipVersion } from "./constants.js";

import {
  bufferFromIterable,
  normalizeDataSource,
  readableStreamFromIterable,
  textFromIterable,
  type ByteStream,
  type DataSource,
} from "../util/streams.js";
import { ExtraFieldCollection } from "./extra-field-collection.js";
import {
  DosFileAttributes,
  getAttributesPlatform,
  type FileAttributes,
} from "./file-attributes.js";
import { GeneralPurposeFlags } from "./flags.js";

export type ZipEntryInfo = {
  attributes?: FileAttributes;
  comment?: string;
  compressedSize?: number;
  compressionMethod?: CompressionMethod;
  crc32?: number;
  extraField?: ExtraFieldCollection;
  flags?: GeneralPurposeFlags;
  lastModified?: Date;
  localHeaderOffset?: number;
  noValidateVersion?: boolean;
  path?: string;
  uncompressedData?: DataSource;
  uncompressedSize?: number;
  utf8?: boolean;
  versionMadeBy?: ZipVersion;
  versionNeeded?: ZipVersion;
  zip64?: boolean;
};

export class ZipEntry implements AsyncIterable<Uint8Array> {
  public attributes: FileAttributes;
  public comment: string;
  public compressedSize: number;
  public compressionMethod: CompressionMethod;
  public crc32: number;
  public extraField: ExtraFieldCollection;
  public flags: GeneralPurposeFlags;
  public lastModified: Date;
  public localHeaderOffset: number;
  public path: string;
  public uncompressedData: ByteStream;
  public uncompressedSize: number;
  public versionMadeBy: ZipVersion;
  public versionNeeded: ZipVersion;
  public zip64: boolean;

  public get isDirectory(): boolean {
    return this.path.endsWith("/") || !!this.attributes.isDirectory;
  }

  public get isFile(): boolean {
    return !this.path.endsWith("/") && !!this.attributes.isFile;
  }

  public get platformMadeBy(): ZipPlatform {
    return getAttributesPlatform(this.attributes);
  }

  public constructor(fields: ZipEntryInfo = {}) {
    this.attributes = fields.attributes ?? new DosFileAttributes();
    this.comment = fields.comment ?? "";
    this.compressedSize = fields.compressedSize ?? 0;
    this.compressionMethod =
      fields.compressionMethod ?? CompressionMethod.Stored;
    this.crc32 = fields.crc32 ?? 0;
    this.extraField = fields.extraField ?? new ExtraFieldCollection();
    this.flags = new GeneralPurposeFlags(fields.flags?.value ?? 0);
    this.lastModified = fields.lastModified ?? new Date();
    this.localHeaderOffset = fields.localHeaderOffset ?? 0;
    this.path = fields.path ?? "";
    this.uncompressedData = normalizeDataSource(fields.uncompressedData);
    this.uncompressedSize = fields.uncompressedSize ?? 0;
    this.zip64 = needs64bit(fields);

    this.flags.hasDataDescriptor = needsDataDescriptor(fields);
    this.flags.hasUtf8Strings = needsUtf8(fields);

    if (fields.noValidateVersion) {
      this.versionMadeBy = fields.versionMadeBy ?? ZipVersion.Utf8Encoding;
      this.versionNeeded = fields.versionNeeded ?? ZipVersion.Utf8Encoding;
    } else {
      this.versionMadeBy = minimumVersion(fields, fields.versionMadeBy);
      this.versionNeeded = minimumVersion(fields, fields.versionNeeded);
    }
  }

  public async toBuffer(): Promise<Uint8Array> {
    return await bufferFromIterable(this.uncompressedData);
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  public toReadableStream(): ReadableStream {
    return readableStreamFromIterable(this.uncompressedData);
  }

  public async toText(encoding?: string): Promise<string> {
    return await textFromIterable(this.uncompressedData, encoding);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.uncompressedData;
  }
}

export function minimumVersion(
  options: ZipEntryInfo,
  requestedVersion?: ZipVersion,
): ZipVersion {
  const utf8 = needsUtf8(options);
  const zip64 = needs64bit(options);

  const minRequired = Math.max(
    requestedVersion ?? ZipVersion.Deflate,
    utf8 ? ZipVersion.Utf8Encoding : ZipVersion.Deflate,
    zip64 ? ZipVersion.Zip64 : ZipVersion.Deflate,
  ) as ZipVersion;

  if (requestedVersion !== undefined && requestedVersion < minRequired) {
    throw new Error(
      `versionMadeBy is explicitly set but is lower than the required value`,
    );
  }

  return minRequired;
}

export function needs64bit(entry: ZipEntryInfo): boolean {
  const value =
    !!entry.extraField?.getField(ExtraFieldTag.Zip64ExtendedInfo) ||
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

export function needsDataDescriptor(values: ZipEntryInfo): boolean {
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
