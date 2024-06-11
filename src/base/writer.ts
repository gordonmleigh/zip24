import {
  CompressionMethod,
  DosFileAttributes,
  UnixFileAttributes,
  ZipPlatform,
} from "../common.js";
import { assert } from "../internal/assert.js";
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
  dosFileAttributes?: DosFileAttributes;
  modifiedTime?: Date;
  path: string;
  uncompressedSize?: number;
  unixFileAttributes?: UnixFileAttributes;
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
    const { dosFileAttributes, unixFileAttributes, ...rest } = entry;

    let externalFileAttributes: number | undefined;
    let platformMadeBy: ZipPlatform | undefined;

    if (dosFileAttributes) {
      assert(
        !unixFileAttributes,
        `specify either dosFileAttributes or unixFileAttributes`,
      );

      externalFileAttributes = dosFileAttributes.value;
      platformMadeBy = ZipPlatform.DOS;
    } else if (unixFileAttributes) {
      externalFileAttributes = (unixFileAttributes.value & 0xffff) << 16;
      platformMadeBy = ZipPlatform.UNIX;
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
