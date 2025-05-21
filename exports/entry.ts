import { assert } from "../util/assert.ts";
import { canBeCodePage437Encoded } from "../util/cp437.ts";
import { computeCrc32 } from "../util/crc32.ts";
import {
  CountBytesStream,
  Crc32Stream,
  normalizeByteSourceProvider,
  normalizeDataSource,
  type ByteSourceProvider,
  type DataSource,
} from "../util/streams.ts";
import { ZipFormatError } from "./errors.ts";
import {
  CentralDirectoryHeader,
  type CentralDirectoryHeaderInit,
} from "./raw/central-directory-header.ts";
import {
  CompressionMethod,
  ExtraFieldTag,
  ZipPlatform,
  ZipVersion,
} from "./raw/constants.ts";
import { ExtraFieldCollection } from "./raw/extra-field-collection.ts";
import {
  DosFileAttributes,
  type FileAttributes,
} from "./raw/file-attributes.ts";
import { GeneralPurposeFlags } from "./raw/flags.ts";

/**
 * Represents an entry in a zip file.
 */
export class ZipEntryBase {
  readonly #header: CentralDirectoryHeader;

  public get header(): CentralDirectoryHeader {
    return this.#header;
  }

  public get attributes(): FileAttributes {
    return this.#header.attributes;
  }
  public get comment(): string {
    return this.#header.comment;
  }
  public get compressedSize(): number {
    return this.#header.compressedSize;
  }
  public get compressionMethod(): number {
    return this.#header.compressionMethod;
  }
  public get crc32(): number {
    return this.#header.crc32;
  }
  public get extraField(): ExtraFieldCollection {
    return this.#header.extraField;
  }
  public get flags(): GeneralPurposeFlags {
    return this.#header.flags;
  }
  public get lastModified(): Date {
    return this.#header.lastModified;
  }
  public get localHeaderOffset(): number {
    return this.#header.localHeaderOffset;
  }
  public get path(): string {
    return this.#header.path;
  }
  public get platformMadeBy(): ZipPlatform {
    return this.#header.platformMadeBy;
  }
  public get uncompressedSize(): number {
    return this.#header.uncompressedSize;
  }
  public get versionMadeBy(): number {
    return this.#header.versionMadeBy;
  }
  public get versionNeeded(): number {
    return this.#header.versionNeeded;
  }
  public get zip64(): boolean {
    return this.#header.zip64;
  }

  public get isDirectory(): boolean {
    return this.path.endsWith("/") || !!this.attributes.isDirectory;
  }
  public get isFile(): boolean {
    return !this.path.endsWith("/") && !!this.attributes.isFile;
  }

  public constructor(header: CentralDirectoryHeaderInit) {
    this.#header =
      header instanceof CentralDirectoryHeader
        ? header
        : new CentralDirectoryHeader(header);
  }
}

/**
 * Reads an entry from a zip file.
 */
export class ZipEntryReader
  extends ZipEntryBase
  implements AsyncIterable<Uint8Array>
{
  readonly #data: () => ReadableStream<Uint8Array>;

  public constructor(header: CentralDirectoryHeader, data: ByteSourceProvider) {
    super(header);
    if (data instanceof Uint8Array) {
      assert(
        data.byteLength === header.compressedSize,
        `supplied data length must match compressed size in header`,
      );
    }
    this.#data = normalizeByteSourceProvider(data);
  }

  public [Symbol.asyncIterator](): AsyncIterator<Uint8Array, void, void> {
    return this.open()[Symbol.asyncIterator]();
  }

  /**
   * Returns a stream for the uncompressed data.
   */
  public open(): ReadableStream<Uint8Array> {
    let source = this.#data().pipeThrough(
      new CountBytesStream((count) => {
        if (count !== this.compressedSize) {
          throw new ZipFormatError(`entry compressed size mismatch`);
        }
      }),
    );

    if (this.compressionMethod === CompressionMethod.Deflate) {
      source = source.pipeThrough(new DecompressionStream("deflate-raw"));
    } else if (this.compressionMethod !== CompressionMethod.Stored) {
      throw new ZipFormatError(
        `unknown compression method ${this.compressionMethod}`,
      );
    }
    return source
      .pipeThrough(
        new CountBytesStream((count) => {
          if (count !== this.uncompressedSize) {
            throw new ZipFormatError(`entry uncompressed size mismatch`);
          }
        }),
      )
      .pipeThrough(
        new Crc32Stream((result) => {
          if (result !== this.crc32) {
            throw new ZipFormatError(`CRC-32 mismatch`);
          }
        }),
      );
  }

  /**
   * Returns the compressed data.
   */
  public openCompressed(): ReadableStream<Uint8Array> {
    return this.#data();
  }
}

export type ZipEntryInfo = {
  attributes?: FileAttributes | undefined;
  comment?: string | undefined;
  compressedData?: DataSource | undefined;
  compressedSize?: number | undefined;
  compressionMethod?: number | undefined;
  crc32?: number | undefined;
  extraField?: ExtraFieldCollection | undefined;
  flags?: GeneralPurposeFlags | undefined;
  lastModified?: Date | undefined;
  localHeaderOffset?: number | undefined;
  path?: string | undefined;
  uncompressedData?: DataSource | undefined;
  uncompressedSize?: number | undefined;
  utf8?: boolean | undefined;
  versionMadeBy?: number | undefined;
  versionNeeded?: number | undefined;
  zip64?: boolean | undefined;
};

export class ZipEntry extends ZipEntryBase implements ZipEntryInfo {
  readonly #compressedData: ReadableStream<Uint8Array>;

  public get compressedData(): ReadableStream<Uint8Array> {
    return this.#compressedData;
  }

  public constructor(
    fields: ZipEntryInfo = {},
    uncompressedData = fields.uncompressedData,
  ) {
    const [header, data] = normalizeEntry(
      uncompressedData ? { ...fields, uncompressedData } : fields,
    );
    super(header);
    this.#compressedData = compressData(data, this.header, fields);
  }
}

function normalizeEntry(
  fields: ZipEntryInfo,
): [CentralDirectoryHeaderInit, ReadableStream<Uint8Array>] {
  let { compressedSize, crc32, uncompressedData, uncompressedSize } = fields;
  let compressionMethod = fields.compressionMethod ?? CompressionMethod.Deflate;

  if (uncompressedData === undefined) {
    compressionMethod = CompressionMethod.Stored;
  }

  if (typeof uncompressedData === "string") {
    uncompressedData = new TextEncoder().encode(uncompressedData);
  }
  if (uncompressedData instanceof Uint8Array) {
    const computedCrc32 = computeCrc32(uncompressedData);

    if (crc32 === undefined) {
      crc32 = computedCrc32;
    } else {
      assert(crc32 === computedCrc32, `crc32 mismatch`);
    }
    if (uncompressedSize === undefined) {
      uncompressedSize = uncompressedData.length;
    } else {
      assert(uncompressedSize === uncompressedData.length, `size mismatch`);
    }
    if (uncompressedData.length === 0) {
      compressionMethod = CompressionMethod.Stored;
    }
  }
  if (fields.compressionMethod === CompressionMethod.Stored) {
    if (compressedSize === undefined) {
      compressedSize = uncompressedSize;
    } else {
      assert(uncompressedSize === compressedSize, `size mismatch`);
    }
  }

  const path = fields.path ?? "";
  const isDirectory = path.endsWith("/");

  const attributes =
    fields.attributes ??
    new DosFileAttributes({
      [DosFileAttributes.Directory]: isDirectory,
      [DosFileAttributes.File]: !isDirectory,
    });

  const flags = fields.flags
    ? new GeneralPurposeFlags(fields.flags.value)
    : new GeneralPurposeFlags({
        [GeneralPurposeFlags.HasUtf8Strings]: needsUtf8(fields),
      });

  if (
    crc32 === undefined ||
    compressedSize === undefined ||
    uncompressedSize === undefined
  ) {
    flags.hasDataDescriptor = true;
  }

  return [
    {
      attributes,
      comment: fields.comment ?? "",
      compressedSize: compressedSize ?? 0,
      compressionMethod,
      crc32: crc32 ?? 0,
      extraField: fields.extraField ?? new ExtraFieldCollection(),
      flags,
      lastModified: fields.lastModified ?? new Date(),
      localHeaderOffset: fields.localHeaderOffset ?? 0,
      path,
      uncompressedSize: uncompressedSize ?? 0,
      versionMadeBy: minimumVersion(fields, fields.versionMadeBy),
      versionNeeded: minimumVersion(fields, fields.versionNeeded),
      zip64: fields.zip64 ?? needs64bit(fields),
    },
    normalizeDataSource(uncompressedData),
  ];
}

function compressData(
  data: ReadableStream<Uint8Array>,
  header: CentralDirectoryHeader,
  fields: ZipEntryInfo,
): ReadableStream<Uint8Array> {
  if (fields.compressedData !== undefined) {
    assert(
      fields.uncompressedSize !== undefined && fields.crc32 !== undefined,
      `must supply uncompressedSize and crc32 with compressedData`,
    );
    return normalizeDataSource(fields.compressedData);
  }

  const countCompressed = new CountBytesStream((count) => {
    if (fields.compressedSize !== undefined) {
      assert(count === fields.compressedSize, "data size mismatch");
    }
    header.compressedSize = count;
  });
  const countUncompressed = new CountBytesStream((count) => {
    if (fields.uncompressedSize !== undefined) {
      assert(count === fields.uncompressedSize, "data size mismatch");
    }
    header.uncompressedSize = count;
  });
  const crc32 = new Crc32Stream((result) => {
    if (fields.crc32 !== undefined) {
      assert(result === fields.crc32, "crc32 mismatch");
    }
    header.crc32 = result;
  });

  let compressedData = data.pipeThrough(countUncompressed).pipeThrough(crc32);
  if (header.compressionMethod === CompressionMethod.Deflate) {
    compressedData = compressedData.pipeThrough(
      new CompressionStream("deflate-raw"),
    );
  } else {
    assert(
      header.compressionMethod === CompressionMethod.Stored,
      `unknown compression method ${header.compressionMethod}`,
    );
  }

  return compressedData.pipeThrough(countCompressed);
}

export function minimumVersion(
  options: ZipEntryInfo,
  requestedVersion?: number,
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
