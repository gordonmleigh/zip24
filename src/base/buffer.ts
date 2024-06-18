import { assert } from "../internal/assert.js";
import { BufferView, type BufferLike } from "../internal/binary.js";
import {
  readEocdr,
  type CentralDirectory,
} from "../internal/central-directory.js";
import {
  getDirectoryHeaderLength,
  readDirectoryEntry,
} from "../internal/directory-entry.js";
import type { CompressionAlgorithms } from "../internal/field-types.js";
import type { ZipReaderLike } from "../internal/interfaces.js";
import { readLocalHeaderSize } from "../internal/local-entry.js";
import { defaultDecompressors } from "./compression.js";
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
export class ZipBufferReader implements ZipReaderLike {
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
  public get entryCount(): number {
    return this.directory.count;
  }

  public constructor(buffer: BufferLike, options: ZipBufferReaderOptions = {}) {
    this.buffer = new BufferView(buffer);
    this.decompressors = options.decompressors ?? defaultDecompressors;

    this.directory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };
    const { ok } = readEocdr(this.directory, buffer, 0);
    assert(ok, `expected to find EOCDR in buffer`);
  }

  /**
   * Iterate through the files in the zip synchronously.
   */
  public *filesSync(): Generator<ZipEntryReader> {
    let offset = this.directory.offset;

    for (let index = 0; index < this.entryCount; ++index) {
      const entry = new ZipEntryReader();
      readDirectoryEntry(entry, this.buffer, offset);
      offset += getDirectoryHeaderLength(entry);

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
