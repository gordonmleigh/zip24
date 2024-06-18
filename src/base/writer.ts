import {
  CompressionMethod,
  DosFileAttributes,
  UnixFileAttributes,
  ZipPlatform,
} from "../internal/field-types.js";
import { readableStreamFromIterable } from "../internal/streams.js";
import {
  ZipWriterBase,
  type ZipEntryData,
  type ZipWriterBaseOptions,
} from "../internal/zip-writer-base.js";
import { defaultCompressors } from "./compression.js";

/**
 * Represents info about a file entry in a zip.
 */
export type ZipEntryInfo = {
  comment?: string;
  compressionMethod?: CompressionMethod;
  compressedSize?: number;
  crc32?: number;
  attributes?: DosFileAttributes | UnixFileAttributes;
  modifiedTime?: Date;
  path: string;
  uncompressedSize?: number;
  zip64?: boolean;
};

/**
 * Options for creating a {@link ZipWriter}.
 */
export type ZipWriterOptions = Partial<ZipWriterBaseOptions>;

/**
 * An object which can output a zip file.
 */
export class ZipWriter implements AsyncIterable<Uint8Array> {
  private readonly writer: ZipWriterBase;

  public constructor(options: ZipWriterOptions = {}) {
    const { compressors = defaultCompressors } = options;
    this.writer = new ZipWriterBase({ compressors });
  }

  /**
   * Get an iterator for the output file data chunks.
   */
  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.writer;
  }

  /**
   * Add a file to the zip with the given data.
   */
  public async addFile(
    entry: ZipEntryInfo,
    content?: ZipEntryData,
  ): Promise<void> {
    const { attributes, ...rest } = entry;

    let externalFileAttributes = 0;
    let platformMadeBy: ZipPlatform | undefined;

    if (attributes instanceof DosFileAttributes) {
      externalFileAttributes = attributes.value;
      platformMadeBy = ZipPlatform.DOS;
    } else if (attributes instanceof UnixFileAttributes) {
      externalFileAttributes = ((attributes.value & 0xffff) << 16) >>> 0;
      platformMadeBy = ZipPlatform.UNIX;
    } else if (attributes !== undefined) {
      throw new Error(`invalid value for attributes`);
    }

    await this.writer.addFileEntry(
      {
        ...rest,
        externalFileAttributes,
        platformMadeBy,
      },
      content,
    );
  }

  /**
   * Return a {@link ReadableStream} for the output file data.
   */
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  public asReadableStream(): ReadableStream {
    return readableStreamFromIterable(this);
  }

  /**
   * Signal that all files have been added and the output should be finalized.
   */
  public async finalize(): Promise<void> {
    await this.writer.finalize();
  }
}
