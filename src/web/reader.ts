import { readZip64Eocdr, readZipTrailer } from "../core/central-directory.js";
import {
  decompress,
  type CompressionAlgorithms,
} from "../core/compression-core.js";
import {
  getDirectoryHeaderLength,
  readDirectoryHeader,
  readDirectoryVariableFields,
} from "../core/directory-entry.js";
import type { ZipReaderLike } from "../core/interfaces.js";
import { readLocalHeaderSize } from "../core/local-entry.js";
import type { CentralDirectory } from "../core/records.js";
import {
  CentralHeaderLength,
  LocalHeaderLength,
  Zip64EocdrLength,
} from "../core/signatures.js";
import { assert } from "../util/assert.js";
import { asyncDisposeOrClose } from "../util/disposable.js";
import { lazy } from "../util/lazy.js";
import {
  iterableFromRandomAccessReader,
  type RandomAccessReader,
} from "../util/streams.js";
import type { Constructor } from "../util/type-utils.js";
import { defaultDecompressors } from "./compression.js";
import { ZipEntryReader } from "./entry-reader.js";

const DefaultBufferSize = 1024 ** 2;

/**
 * Options for {@link ZipReader} instance.
 */
export type ZipReaderOptions = {
  bufferSize?: number;
  decompressors?: CompressionAlgorithms;
};

/**
 * An object which can read a zip file from a {@link RandomAccessReader}.
 */
export class ZipReader implements ZipReaderLike, AsyncDisposable, Disposable {
  /**
   * Create a new instance and call open().
   */
  public static async fromReader<Instance extends ZipReader>(
    this: Constructor<
      Instance,
      [RandomAccessReader, number, ZipReaderOptions | undefined]
    >,
    reader: RandomAccessReader,
    fileSize: number,
    options?: ZipReaderOptions,
  ): Promise<Instance> {
    const instance = new this(reader, fileSize, options);
    await instance.open();
    return instance;
  }

  private readonly bufferSize: number;
  private readonly decompressors: CompressionAlgorithms;
  private readonly fileSize: number;
  private readonly reader: RandomAccessReader;

  private directory?: CentralDirectory;

  /**
   * Get the file comment, if set.
   */
  public get comment(): string {
    assert(this.directory, `call open() first`);
    return this.directory.comment;
  }

  /**
   * Get the total number of entries in the zip.
   */
  public get entryCount(): number {
    assert(this.directory, `call open() first`);
    return this.directory.count;
  }

  public constructor(
    reader: RandomAccessReader,
    fileSize: number,
    options: ZipReaderOptions = {},
  ) {
    this.bufferSize = options.bufferSize ?? DefaultBufferSize;
    this.decompressors = options.decompressors ?? defaultDecompressors;
    this.fileSize = fileSize;
    this.reader = reader;
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryReader> {
    return this.files();
  }

  /**
   * Close the underlying reader.
   */
  public [Symbol.dispose](): void {
    void this.close();
  }

  /**
   * Close the underlying reader.
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Close the underlying reader.
   */
  public async close(): Promise<void> {
    await asyncDisposeOrClose(this.reader);
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public async *files(): AsyncGenerator<ZipEntryReader> {
    await this.open();
    assert(this.directory, `expected this.directory to have a value`);

    const buffer = new Uint8Array(this.bufferSize);

    let position = this.directory.offset;
    let offset = 0;
    let bufferLength = 0;

    const ensureBuffer = async (length: number): Promise<void> => {
      assert(
        length <= buffer.byteLength,
        `the configured buffer size (${this.bufferSize}) is too small to read the full entry (${length})`,
      );

      if (offset + length > bufferLength) {
        // there isn't enough buffer left to read all of the variable fields, so
        // read a new chunk starting from the current file offset (position + offset)
        position = position - bufferLength + offset;
        offset = 0;

        const result = await this.reader.read({ buffer, position });
        assert(result.bytesRead >= length, `unexpected end of file`);
        bufferLength = result.bytesRead;
        position += result.bytesRead;
      }
    };

    // read the central directory a chunk at a time
    for (let index = 0; index < this.entryCount; ++index) {
      const entry = new ZipEntryReader();

      await ensureBuffer(CentralHeaderLength);
      readDirectoryHeader(entry, buffer, offset);

      const headerLength = getDirectoryHeaderLength(entry);

      await ensureBuffer(headerLength);
      readDirectoryVariableFields(entry, buffer, offset);

      entry.uncompressedData = getData(entry, this.reader, this.decompressors);

      offset += headerLength;
      yield entry;
    }
  }

  /**
   * Open the file and initialize the instance state.
   */
  public async open(): Promise<void> {
    await this.openInternal();
  }

  private readonly openInternal = lazy(async (): Promise<void> => {
    // read up to the buffer size to try find all of the trailer
    const bufferSize = Math.min(this.fileSize, this.bufferSize);
    const position = this.fileSize - bufferSize;

    const buffer = new Uint8Array(bufferSize);
    const readResult = await this.reader.read({ buffer, position });
    assert(readResult.bytesRead === bufferSize, `unexpected end of file`);

    const result = readZipTrailer(buffer, position);
    this.directory = result.directory;

    if (!result.ok) {
      // we didn't manage to read the zip64 eocdr within the original buffer
      const readResult = await this.reader.read({
        buffer,
        position: result.eocdr64Offset,
        length: Zip64EocdrLength,
      });

      assert(
        readResult.bytesRead === Zip64EocdrLength,
        `unexpected end of file`,
      );

      readZip64Eocdr(this.directory, buffer);
    }
  });
}

function getData(
  entry: ZipEntryReader,
  reader: RandomAccessReader,
  decompressors: CompressionAlgorithms,
): AsyncIterable<Uint8Array> {
  const getDataOffset = lazy(async () => {
    const buffer = new Uint8Array(LocalHeaderLength);

    const result = await reader.read({
      buffer,
      position: entry.localHeaderOffset,
    });

    assert(result.bytesRead === LocalHeaderLength, `unexpected end of file`);
    return entry.localHeaderOffset + readLocalHeaderSize(buffer, 0);
  });

  return {
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Uint8Array> {
      const position = await getDataOffset();

      yield* decompress(
        entry.compressionMethod,
        entry,
        iterableFromRandomAccessReader(reader, {
          position,
          byteLength: entry.compressedSize,
        }),
        decompressors,
      );
    },
  };
}
