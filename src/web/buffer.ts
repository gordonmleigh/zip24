import {
  decompress,
  type CompressionAlgorithms,
} from "../core/compression-core.js";
import {
  getDirectoryHeaderLength,
  readDirectoryEntry,
} from "../core/directory-entry.js";
import type { ZipReaderLike } from "../core/interfaces.js";
import { readLocalHeaderSize } from "../core/local-entry.js";
import {
  Eocdr,
  Zip64Eocdl,
  Zip64Eocdr,
  ZipTrailer,
} from "../core/zip-trailer.js";
import { BufferView, type BufferLike } from "../util/binary.js";
import { defaultDecompressors } from "./compression.js";
import { ZipEntryReader } from "./entry-reader.js";

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
  private readonly trailer: ZipTrailer;

  /**
   * The zip file comment, if set.
   */
  public get comment(): string {
    return this.trailer.comment;
  }

  /**
   * The number of file entries in the zip.
   */
  public get entryCount(): number {
    return this.trailer.count;
  }

  public constructor(buffer: BufferLike, options: ZipBufferReaderOptions = {}) {
    this.buffer = new BufferView(buffer);
    this.decompressors = options.decompressors ?? defaultDecompressors;

    const eocdrOffset = Eocdr.findOffset(buffer);
    const eocdr = Eocdr.deserialize(buffer, eocdrOffset);
    const eocdl = Zip64Eocdl.find(buffer, eocdrOffset);
    const eocdr64 = eocdl && Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset);

    this.trailer = new ZipTrailer(eocdr, eocdr64);
  }

  /**
   * Iterate through the files in the zip synchronously.
   */
  public *filesSync(): Generator<ZipEntryReader> {
    let offset = this.trailer.offset;

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
        entry.compressionMethod,
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
