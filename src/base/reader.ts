import type {
  CompressionAlgorithms,
  ZipEntryLike,
  ZipReaderLike,
} from "../common.js";
import { assert } from "../internal/assert.js";
import {
  readEocdr,
  readZip64Eocdr,
  type CentralDirectory,
} from "../internal/central-directory.js";
import {
  readDirectoryEntry,
  readDirectoryVariableFields,
} from "../internal/directory-entry.js";
import { lazy } from "../internal/lazy.js";
import { readLocalHeaderSize } from "../internal/local-entry.js";
import {
  CentralHeaderLength,
  LocalHeaderLength,
} from "../internal/signatures.js";
import {
  iterableFromRandomAccessReader,
  type RandomAccessReader,
} from "../internal/streams.js";
import { defaultDecompressors } from "./compression.js";
import { ZipEntryReader, decompress } from "./entry-reader.js";

/**
 * Options for {@link ZipReader} instance.
 */
export type ZipReaderOptions = {
  decompressors?: CompressionAlgorithms;
};

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
    this.decompressors = options.decompressors ?? defaultDecompressors;
    this.fileSize = fileSize;
    this.reader = reader;
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryLike> {
    return this.files();
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public async *files(): AsyncGenerator<ZipEntryLike> {
    await this.open();
    assert(this.directory, `expected this.directory to have a value`);

    const buffer = new Uint8Array(1024 ** 2);

    let position = this.directory.offset;
    let offset = 0;
    let bufferLength = 0;

    // read the central directory a chunk at a time
    for (let index = 0; index < this.entryCount; ++index) {
      if (offset + CentralHeaderLength >= bufferLength) {
        // we ran out of buffer, read a new chunk
        const result = await this.reader.read({ buffer, position });
        offset = 0;
        bufferLength = result.bytesRead;
        position += result.bytesRead;
      }

      const entry = new ZipEntryReader();
      readDirectoryEntry(entry, buffer, offset);

      if (offset + entry.totalRecordLength <= buffer.byteLength) {
        readDirectoryVariableFields(entry, buffer, offset);
      } else {
        // we ran out of buffer, read a new chunk from the current offset
        position -= bufferLength - offset;
        const result = await this.reader.read({ buffer, position });
        position += result.bytesRead;
        bufferLength = result.bytesRead;
        readDirectoryVariableFields(entry, buffer, offset);
      }

      entry.uncompressedData = getData(entry, this.reader, this.decompressors);

      offset += entry.totalRecordLength;
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
    if (this.directory) {
      return;
    }

    // read up to 1MB to find all of the trailer
    const bufferSize = Math.min(this.fileSize, 1024 ** 2);
    const position = this.fileSize - bufferSize;

    const buffer = new Uint8Array(bufferSize);
    const readResult = await this.reader.read({ buffer, position });
    assert(readResult.bytesRead === bufferSize, `unexpected end of file`);

    this.directory = {
      comment: "",
      count: 0,
      offset: 0,
      size: 0,
    };
    const result = readEocdr(this.directory, buffer, position);

    if (!result.ok) {
      // we didn't manage to read the zip64 eocdr within the original buffer
      const readResult = await this.reader.read({
        buffer,
        position: result.eocdr64Offset,
        length: result.byteLength,
      });

      assert(readResult.bytesRead === bufferSize, `unexpected end of file`);
      readZip64Eocdr(this.directory, buffer, 0);
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

    assert(result.bytesRead === LocalHeaderLength, `unexpected EOF`);
    return entry.localHeaderOffset + readLocalHeaderSize(buffer, 0);
  });

  return {
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<Uint8Array> {
      const position = await getDataOffset();

      yield* decompress(
        entry,
        iterableFromRandomAccessReader(reader, { position }),
        decompressors,
      );
    },
  };
}
