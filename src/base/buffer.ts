import type { ZipEntryReaderLike, ZipReaderLike } from "../common.js";
import { BufferView, type BufferLike } from "../internal/binary.js";
import { ZipDirectoryReader } from "../internal/directory-reader.js";
import {
  EntryReaderBase,
  type ZipEntryReaderOptions,
} from "../internal/entry-reader-base.js";
import { LocalHeaderReader } from "../internal/local-header-reader.js";
import { ZipTrailerReader } from "../internal/trailer-reader.js";

/**
 * Options for {@link ZipBufferEntryReader}.
 */
export type ZipBufferReaderOptions = ZipEntryReaderOptions;

/**
 * An object which can read zip entry data from a buffer.
 */
export class ZipBufferEntryReader extends EntryReaderBase {
  public readonly compressedData: Uint8Array;

  public constructor(
    reader: ZipDirectoryReader,
    compressedData: Uint8Array,
    options?: ZipEntryReaderOptions,
  ) {
    super(reader, options);
    this.compressedData = compressedData;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface
  protected override async *getCompressedData(): AsyncIterableIterator<Uint8Array> {
    yield this.compressedData;
  }
}

/**
 * An object which can read zip data from a buffer.
 */
export class ZipBufferReader implements ZipReaderLike {
  private readonly buffer: BufferView;
  private readonly options: ZipBufferReaderOptions;
  private readonly trailer: ZipTrailerReader;

  /**
   * The zip file comment, if set.
   */
  public get comment(): string {
    return this.trailer.fileComment;
  }

  /**
   * The number of file entries in the zip.
   */
  public get fileCount(): number {
    return this.trailer.centralDirectoryEntries;
  }

  public constructor(buffer: BufferLike, options: ZipBufferReaderOptions = {}) {
    this.options = options;
    this.buffer = new BufferView(buffer);
    this.trailer = new ZipTrailerReader();
    this.trailer.readEocdr(buffer, 0);
  }

  /**
   * Iterate through the files in the zip synchronously.
   */
  public *filesSync(): Generator<ZipEntryReaderLike> {
    const directory = new ZipDirectoryReader();
    const local = new LocalHeaderReader();

    let offset = this.trailer.centralDirectoryOffset;

    for (let index = 0; index < this.fileCount; ++index) {
      offset += directory.read(this.buffer, offset);

      const localHeaderSize = local.read(
        this.buffer,
        directory.localHeaderOffset,
      );

      const data = this.buffer.getOriginalBytes(
        directory.localHeaderOffset + localHeaderSize,
        directory.compressedSize,
      );

      yield new ZipBufferEntryReader(directory, data, this.options);
    }
  }

  /**
   * Iterate through the files in the zip.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface
  public async *files(): AsyncGenerator<ZipEntryReaderLike> {
    yield* this.filesSync();
  }

  public [Symbol.iterator](): Iterator<ZipEntryReaderLike> {
    return this.filesSync();
  }

  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryReaderLike> {
    return this.files();
  }
}
