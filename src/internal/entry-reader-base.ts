import { defaultDecompressors } from "../base/compression.js";
import {
  CompressionMethod,
  DosFileAttributes,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
  type CompressionAlgorithms,
  type ZipEntryReaderLike,
} from "../common.js";
import { assert } from "./assert.js";
import { computeCrc32 } from "./crc32.js";
import { ZipDirectoryReader } from "./directory-reader.js";
import { bufferFromIterable, readableStreamFromIterable } from "./streams.js";

export type ZipEntryReaderOptions = {
  /**
   * A map of compression methods to decompression algorithms.
   */
  decompressors?: CompressionAlgorithms;
};

export abstract class EntryReaderBase implements ZipEntryReaderLike {
  private readonly decompressors: CompressionAlgorithms;

  public readonly attributes: number;
  public readonly comment: string;
  public readonly compressionMethod: CompressionMethod;
  public readonly compressedSize: number;
  public readonly crc32: number;
  public readonly lastModified: Date;
  public readonly path: string;
  public readonly platformMadeBy: ZipPlatform;
  public readonly uncompressedSize: number;
  public readonly versionMadeBy: ZipVersion;
  public readonly versionNeeded: ZipVersion;

  public readonly dosFileAttributes?: DosFileAttributes;
  public readonly unixFileAttributes?: UnixFileAttributes;

  public get isDirectory(): boolean {
    return (
      this.path.endsWith("/") ||
      !!this.dosFileAttributes?.isDirectory ||
      !!this.unixFileAttributes?.isDirectory
    );
  }

  public get isSymbolicLink(): boolean {
    return !!this.unixFileAttributes?.isSymbolicLink;
  }

  public constructor(
    reader: ZipDirectoryReader,
    options: ZipEntryReaderOptions = {},
  ) {
    this.attributes = reader.externalFileAttributes;
    this.decompressors = options.decompressors ?? defaultDecompressors;
    this.comment = reader.fileComment;
    this.compressionMethod = reader.compressionMethod;
    this.compressedSize = reader.compressedSize;
    this.crc32 = reader.crc32;
    this.lastModified = reader.lastModified;
    this.path = reader.fileName;
    this.platformMadeBy = reader.platformMadeBy;
    this.uncompressedSize = reader.uncompressedSize;
    this.versionMadeBy = reader.versionMadeBy;
    this.versionNeeded = reader.versionNeeded;

    if (this.platformMadeBy === ZipPlatform.DOS) {
      this.dosFileAttributes = new DosFileAttributes(this.attributes & 0xff);
    }
    if (this.platformMadeBy === ZipPlatform.UNIX) {
      this.unixFileAttributes = new UnixFileAttributes(this.attributes >>> 16);
    }
  }

  public async *getData(): AsyncGenerator<Uint8Array> {
    const input = this.getCompressedData();
    const decompressor = this.decompressors[this.compressionMethod];
    let output: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

    if (decompressor) {
      output = decompressor(input);
    } else if (this.compressionMethod === CompressionMethod.Stored) {
      output = input;
    } else {
      throw new Error(
        `unknown compression method ${(this.compressionMethod as number).toString(16)}`,
      );
    }

    let checkCrc32: number | undefined;
    let bytesRead = 0;

    for await (const chunk of output) {
      checkCrc32 = computeCrc32(chunk, checkCrc32);
      bytesRead += chunk.byteLength;
      yield chunk;
    }

    assert(
      bytesRead === this.uncompressedSize && this.crc32 === checkCrc32,
      `zip file is corrupt`,
    );
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  public createReadableStream(): ReadableStream {
    return readableStreamFromIterable(this.getData());
  }

  public async getBuffer(): Promise<Uint8Array> {
    return await bufferFromIterable(this.getData());
  }

  public async getText(encoding?: string): Promise<string> {
    const decoder = new TextDecoder(encoding);
    let output = "";

    for await (const chunk of this.getData()) {
      output += decoder.decode(chunk, { stream: true });
    }

    output += decoder.decode();
    return output;
  }

  public [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return this.getData();
  }

  protected abstract getCompressedData(): AsyncIterableIterator<Uint8Array>;
}
