import { defaultDecompressors } from "../base/compression.js";
import {
  CompressionMethod,
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

  public readonly comment: string;
  public readonly compressionMethod: CompressionMethod;
  public readonly compressedSize: number;
  public readonly crc32: number;
  public readonly lastModified: Date;
  public readonly path: string;
  public readonly uncompressedSize: number;

  public constructor(
    reader: ZipDirectoryReader,
    options: ZipEntryReaderOptions = {},
  ) {
    this.decompressors = options.decompressors ?? defaultDecompressors;
    this.comment = reader.fileComment;
    this.compressionMethod = reader.compressionMethod;
    this.compressedSize = reader.compressedSize;
    this.crc32 = reader.crc32;
    this.lastModified = reader.lastModified;
    this.path = reader.fileName;
    this.uncompressedSize = reader.uncompressedSize;
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

  public [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return this.getData();
  }

  protected abstract getCompressedData(): AsyncIterableIterator<Uint8Array>;
}
