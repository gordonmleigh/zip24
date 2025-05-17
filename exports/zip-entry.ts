import { assert } from "../util/assert.ts";
import { canBeCodePage437Encoded } from "../util/cp437.ts";
import {
  CountBytesStream,
  Crc32Stream,
  normalizeDataSource,
  read,
  type DataSource,
  type RandomAccessReader,
} from "../util/streams.ts";
import { ZipFormatError } from "./errors.ts";
import {
  CentralDirectoryHeader,
  type CentralDirectoryHeaderInit,
} from "./raw/central-directory-header.js";
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
import { LocalFileHeader } from "./raw/local-file-header.ts";

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
  /**
   * Create a {@link ZipEntryReader} for buffered content.
   */
  public static fromBuffer(
    header: CentralDirectoryHeader,
    dataBuffer: Uint8Array,
  ): ZipEntryReader {
    assert(
      dataBuffer.byteLength === header.compressedSize,
      `supplied data length must match compressedSize in header`,
    );
    return new this(header, () => {
      return new ReadableStream({
        start: (controller) => {
          controller.enqueue(dataBuffer);
          controller.close();
        },
      });
    });
  }

  /**
   * Create a {@link ZipEntryReader} for a {@link RandomAccessReader}.
   */
  public static fromRandomAccessReader(
    header: CentralDirectoryHeader,
    reader: RandomAccessReader,
    bufferSize = 0x20000,
  ): ZipEntryReader {
    let dataStart: number | undefined;

    return new this(header, () => {
      let position = header.localHeaderOffset;
      let end = position + header.compressedSize;

      return new ReadableStream({
        start: async (controller) => {
          if (dataStart !== undefined) {
            position = dataStart;
            end = dataStart + header.compressedSize;
            return;
          }

          const buffer = Buffer.alloc(
            Math.min(bufferSize, header.compressedSize + 512),
          );

          const byteCount = await read(reader, {
            buffer,
            minLength: LocalFileHeader.FixedSize,
            position,
          });

          position += byteCount;
          const headerSize = LocalFileHeader.readTotalSize(buffer);

          dataStart = header.localHeaderOffset + headerSize;
          end = dataStart + header.compressedSize;

          if (byteCount === headerSize) {
            return;
          }

          const firstChunk = buffer.subarray(
            headerSize,
            Math.min(headerSize + header.compressedSize, byteCount),
          );
          controller.enqueue(firstChunk);
        },

        pull: async (controller) => {
          const remaining = end - position;
          if (remaining === 0) {
            controller.close();
            return;
          }

          const buffer = Buffer.alloc(Math.min(remaining, bufferSize));
          const byteCount = await read(reader, { position, buffer });

          assert(byteCount <= remaining);
          position += byteCount;

          if (byteCount === 0) {
            if (remaining - byteCount > 0) {
              throw new ZipFormatError(`unexpected end of file`);
            }
            controller.close();
          } else {
            controller.enqueue(buffer.subarray(0, byteCount));
          }
        },
      });
    });
  }

  readonly #data: () => ReadableStream<Uint8Array>;

  public constructor(
    header: CentralDirectoryHeader,
    data: () => ReadableStream<Uint8Array>,
  ) {
    super(header);
    this.#data = data;
  }

  public [Symbol.asyncIterator](): AsyncIterator<Uint8Array, void, void> {
    return this.open()[Symbol.asyncIterator]();
  }

  /**
   * Returns a stream for the uncompressed data.
   */
  public open(): ReadableStream<Uint8Array> {
    let source = this.#data();
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
            throw new ZipFormatError(`entry size mismatch`);
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
    return new ReadableStream(this.#data());
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
    super({
      attributes: fields.attributes ?? new DosFileAttributes(),
      comment: fields.comment ?? "",
      compressedSize: fields.compressedSize ?? 0,
      compressionMethod: fields.compressionMethod ?? CompressionMethod.Stored,
      crc32: fields.crc32 ?? 0,
      extraField: fields.extraField ?? new ExtraFieldCollection(),
      flags: new GeneralPurposeFlags(fields.flags?.value ?? 0),
      lastModified: fields.lastModified ?? new Date(),
      localHeaderOffset: fields.localHeaderOffset ?? 0,
      path: fields.path ?? "",
      uncompressedSize: fields.uncompressedSize ?? 0,
      versionMadeBy: minimumVersion(fields, fields.versionMadeBy),
      versionNeeded: minimumVersion(fields, fields.versionNeeded),
      zip64: fields.zip64 ?? needs64bit(fields),
    });

    let compressedData: ReadableStream<Uint8Array>;
    if (fields.compressedData !== undefined) {
      assert(
        fields.uncompressedSize !== undefined && fields.crc32 !== undefined,
        `must supply uncompressedSize and crc32 with compressedData`,
      );
      compressedData = normalizeDataSource(fields.compressedData);
    } else if (uncompressedData === undefined) {
      compressedData = normalizeDataSource(undefined);
    } else {
      compressedData = normalizeDataSource(uncompressedData)
        .pipeThrough(
          new CountBytesStream((count) => {
            if (fields.uncompressedSize !== undefined) {
              assert(count === fields.uncompressedSize, "data size mismatch");
            }
            this.header.uncompressedSize = count;
          }),
        )
        .pipeThrough(
          new Crc32Stream((result) => {
            if (fields.crc32 !== undefined) {
              assert(result === fields.crc32, "crc32 mismatch");
            }
            this.header.crc32 = result;
          }),
        );
      if (this.compressionMethod === CompressionMethod.Deflate) {
        compressedData = compressedData.pipeThrough(
          new CompressionStream("deflate-raw"),
        );
      } else {
        assert(
          this.compressionMethod === CompressionMethod.Stored,
          `unknown compression method ${this.compressionMethod}`,
        );
      }
      compressedData = compressedData.pipeThrough(
        new CountBytesStream((count) => {
          if (fields.compressedSize !== undefined) {
            assert(count === fields.compressedSize, "data size mismatch");
          }
          this.header.compressedSize = count;
        }),
      );
    }
    this.#compressedData = compressedData;
  }
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
