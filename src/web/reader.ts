import { CentralDirectoryHeader } from "../core/central-directory-header.js";
import {
  decompress,
  type CompressionAlgorithms,
} from "../core/compression-core.js";
import { LocalFileHeader } from "../core/local-file-header.js";
import { ZipEntry } from "../core/zip-entry.js";
import {
  Eocdr,
  Zip64Eocdl,
  Zip64Eocdr,
  ZipTrailer,
} from "../core/zip-trailer.js";
import { assert } from "../util/assert.js";
import { asyncDisposeOrClose } from "../util/disposable.js";
import { lazy } from "../util/lazy.js";
import {
  iterableFromRandomAccessReader,
  type RandomAccessReader,
} from "../util/streams.js";
import type { Constructor } from "../util/type-utils.js";
import { defaultDecompressors } from "./compression.js";

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
export class ZipReader
  implements AsyncDisposable, AsyncIterable<ZipEntry>, Disposable
{
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

  private trailer?: ZipTrailer;

  /**
   * Get the file comment, if set.
   */
  public get comment(): string {
    assert(this.trailer, `call open() first`);
    return this.trailer.comment;
  }

  /**
   * Get the total number of entries in the zip.
   */
  public get entryCount(): number {
    assert(this.trailer, `call open() first`);
    return this.trailer.count;
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
  public [Symbol.asyncIterator](): AsyncIterator<ZipEntry> {
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
  public async *files(): AsyncGenerator<ZipEntry> {
    await this.open();
    assert(this.trailer, `expected this.directory to have a value`);

    const buffer = new Uint8Array(this.bufferSize);

    let position = this.trailer.offset;
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
      await ensureBuffer(CentralDirectoryHeader.FixedSize);
      const headerLength = CentralDirectoryHeader.readTotalSize(buffer, offset);
      await ensureBuffer(headerLength);

      const header = CentralDirectoryHeader.deserialize(buffer, offset);

      const entry = new ZipEntry({
        attributes: header.attributes,
        comment: header.comment,
        compressedSize: header.compressedSize,
        compressionMethod: header.compressionMethod,
        crc32: header.crc32,
        extraField: header.extraField,
        flags: header.flags,
        lastModified: header.lastModified,
        localHeaderOffset: header.localHeaderOffset,
        path: header.path,
        uncompressedSize: header.uncompressedSize,
        versionMadeBy: header.versionMadeBy,
        versionNeeded: header.versionNeeded,

        uncompressedData: getData(header, this.reader, this.decompressors),

        noValidateVersion: true,
      });

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

    const eocdrOffset = Eocdr.findOffset(buffer);
    const eocdr = Eocdr.deserialize(buffer, eocdrOffset);
    const eocdl = Zip64Eocdl.find(buffer, eocdrOffset);

    if (eocdl) {
      if (eocdl.eocdrOffset < position) {
        // we didn't manage to read the zip64 eocdr within the original buffer
        const readResult = await this.reader.read({
          buffer,
          position: eocdl.eocdrOffset,
          length: Zip64Eocdr.FixedSize,
        });

        assert(
          readResult.bytesRead === Zip64Eocdr.FixedSize,
          `unexpected end of file`,
        );

        this.trailer = new ZipTrailer(eocdr, Zip64Eocdr.deserialize(buffer, 0));
      } else {
        this.trailer = new ZipTrailer(
          eocdr,
          Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset - position),
        );
      }
    } else {
      this.trailer = new ZipTrailer(eocdr);
    }
  });
}

function getData(
  entry: CentralDirectoryHeader,
  reader: RandomAccessReader,
  decompressors: CompressionAlgorithms,
): AsyncIterable<Uint8Array> {
  const getDataOffset = lazy(async () => {
    const buffer = new Uint8Array(LocalFileHeader.FixedSize);

    const result = await reader.read({
      buffer,
      position: entry.localHeaderOffset,
    });

    assert(
      result.bytesRead === LocalFileHeader.FixedSize,
      `unexpected end of file`,
    );
    return entry.localHeaderOffset + LocalFileHeader.readTotalSize(buffer);
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
