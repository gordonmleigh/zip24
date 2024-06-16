import type { CompressionAlgorithms } from "../common.js";
import { assert } from "../internal/assert.js";
import { BufferView, type BufferLike } from "../internal/binary.js";
import {
  readEocdr,
  type CentralDirectory,
} from "../internal/central-directory.js";
import {
  readDirectoryEntry,
  readLocalHeaderSize,
} from "../internal/file-entry.js";
import { defaultCompressors } from "./compression.js";
import { ZipEntryReader, decompress } from "./entry-reader.js";

/**
 * Options for {@link ZipBufferEntryReader}.
 */
export type ZipBufferReaderOptions = {
  decompressors?: CompressionAlgorithms;
};

/**
 * An object which can read zip data from a buffer.
 */
export class ZipBufferReader {
  private readonly buffer: BufferView;
  private readonly decompressors: CompressionAlgorithms;
  private readonly directory: CentralDirectory;

  /**
   * The zip file comment, if set.
   */
  public get comment(): string {
    return this.directory.comment;
  }

  /**
   * The number of file entries in the zip.
   */
  public get fileCount(): number {
    return this.directory.count;
  }

  public constructor(buffer: BufferLike, options: ZipBufferReaderOptions = {}) {
    this.buffer = new BufferView(buffer);
    this.decompressors = options.decompressors ?? defaultCompressors;

    this.directory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };
    const { ok } = readEocdr(this.directory, buffer, 0, 0);
    assert(ok, `expected to find EOCDR in buffer`);
  }

  /**
   * Iterate through the files in the zip synchronously.
   */
  public *filesSync(): Generator<ZipEntryReader> {
    let offset = this.directory.offset;

    for (let index = 0; index < this.fileCount; ++index) {
      const entry = new ZipEntryReader();
      readDirectoryEntry(entry, this.buffer, offset);
      offset += entry.totalRecordLength;

      const localHeaderSize = readLocalHeaderSize(
        this.buffer,
        entry.localHeaderOffset,
      );

      const compressedData = this.buffer.getOriginalBytes(
        entry.localHeaderOffset + localHeaderSize,
        entry.compressedSize,
      );

      entry.uncompressedData = decompress(
        entry,
        [compressedData],
        this.decompressors,
      );

      yield entry;
    }
  }

  /**
   * Iterate through the files in the zip.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface
  public async *files(): AsyncGenerator<ZipEntryReader> {
    yield* this.filesSync();
  }

  public [Symbol.iterator](): Iterator<ZipEntryReader> {
    return this.filesSync();
  }

  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryReader> {
    return this.files();
  }
}
