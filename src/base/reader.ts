import type { ZipEntryReaderLike, ZipReaderLike } from "../common.js";
import { assert } from "../internal/assert.js";
import { ZipDirectoryReader } from "../internal/directory-reader.js";
import {
  EntryReaderBase,
  type ZipEntryReaderOptions,
} from "../internal/entry-reader-base.js";
import { lazy } from "../internal/lazy.js";
import { LocalHeaderReader } from "../internal/local-header-reader.js";
import {
  iterableFromRandomAccessReader,
  type RandomAccessReader,
} from "../internal/streams.js";
import { ZipTrailerReader } from "../internal/trailer-reader.js";

/**
 * Options for {@link ZipReader} instance.
 */
export type ZipReaderOptions = ZipEntryReaderOptions;

/**
 * An object which can read a zip entry from a {@link RandomAccessReader}.
 */
export class ZipEntryReader extends EntryReaderBase {
  private readonly localHeaderPosition: number;
  private readonly reader: RandomAccessReader;

  private dataPosition: number | undefined;

  public constructor(
    entry: ZipDirectoryReader,
    reader: RandomAccessReader,
    options?: ZipEntryReaderOptions,
  ) {
    super(entry, options);
    this.reader = reader;
    this.localHeaderPosition = entry.localHeaderOffset;
  }

  protected override async *getCompressedData(): AsyncIterableIterator<Uint8Array> {
    yield* iterableFromRandomAccessReader(this.reader, {
      position: await this.getDataPosition(),
      byteLength: this.compressedSize,
    });
  }

  protected async getDataPosition(): Promise<number> {
    if (this.dataPosition !== undefined) {
      return this.dataPosition;
    }

    const local = new LocalHeaderReader();
    const buffer = new Uint8Array(local.fixedFieldsLength);

    await this.reader.read({ buffer, position: this.localHeaderPosition });
    local.readHeader(buffer);

    this.dataPosition = this.localHeaderPosition + local.totalRecordLength;
    return this.dataPosition;
  }
}

/**
 * An object which can read a zip file from a {@link RandomAccessReader}.
 */
export class ZipReader implements ZipReaderLike {
  /**
   * Create a new instance and call open().
   */
  public static async fromReader(
    reader: RandomAccessReader,
    fileSize: number,
    options?: ZipReaderOptions,
  ): Promise<ZipReader> {
    const instance = new this(reader, fileSize, options);
    await instance.open();
    return instance;
  }

  private readonly fileSize: number;
  private readonly options: ZipReaderOptions;
  private readonly reader: RandomAccessReader;
  private readonly trailer = new ZipTrailerReader();

  /**
   * Get the file comment, if set.
   */
  public get comment(): string {
    assert(this.trailer.isOpen, `call open() first`);
    return this.trailer.fileComment;
  }

  /**
   * Get the total number of entries in the zip.
   */
  public get fileCount(): number {
    assert(this.trailer.isOpen, `call open() first`);
    return this.trailer.centralDirectoryEntries;
  }

  public constructor(
    reader: RandomAccessReader,
    fileSize: number,
    options: ZipReaderOptions = {},
  ) {
    this.fileSize = fileSize;
    this.options = options;
    this.reader = reader;
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryReaderLike> {
    return this.files();
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public async *files(): AsyncGenerator<ZipEntryReaderLike> {
    for await (const entry of this.entries()) {
      yield new ZipEntryReader(entry, this.reader, this.options);
    }
  }

  /**
   * Open the file and initialize the instance state.
   */
  public async open(): Promise<void> {
    await this.openInternal();
  }

  private async *entries(): AsyncGenerator<ZipDirectoryReader> {
    await this.open();

    // this is a bit of a hack because it just yields the same instance each
    // time, so the values need to be copied
    const directory = new ZipDirectoryReader();
    const buffer = new Uint8Array(1024 ** 2);

    let position = this.trailer.centralDirectoryOffset;
    let offset = 0;
    let bufferLength = 0;

    // read the central directory a chunk at a time
    for (let index = 0; index < this.fileCount; ++index) {
      if (offset + directory.fixedFieldsLength >= bufferLength) {
        // we ran out of buffer, read a new chunk
        const result = await this.reader.read({ buffer, position });
        offset = 0;
        bufferLength = result.bytesRead;
        position += result.bytesRead;
      }

      directory.readHeader(buffer, offset);

      if (offset + directory.totalRecordLength <= buffer.byteLength) {
        directory.readDataFields(buffer, offset);
      } else {
        // we ran out of buffer, read a new chunk from the current offset
        position -= bufferLength - offset;
        const result = await this.reader.read({ buffer, position });
        position += result.bytesRead;
        bufferLength = result.bytesRead;
        directory.readDataFields(buffer, offset);
      }

      offset += directory.totalRecordLength;
      yield directory;
    }
  }

  private readonly openInternal = lazy(async (): Promise<void> => {
    if (this.trailer.isOpen) {
      return;
    }

    // read up to 1MB to find all of the trailer
    const bufferSize = Math.min(this.fileSize, 1024 ** 2);
    const position = this.fileSize - bufferSize;

    const buffer = new Uint8Array(bufferSize);
    const readResult = await this.reader.read({ buffer, position });
    assert(readResult.bytesRead === bufferSize, `unexpected end of file`);

    const trailer = new ZipTrailerReader();
    const result = trailer.readEocdr(buffer);

    if (!result.ok) {
      // we didn't manage to read the zip64 eocdr within the original buffer
      const readResult = await this.reader.read({
        buffer,
        position: result.eocdr64Offset,
        length: result.byteLength,
      });

      assert(readResult.bytesRead === bufferSize, `unexpected end of file`);
      trailer.readZip64Eocdr(buffer, 0);
    }
  });
}
