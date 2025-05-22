import { assert } from "../util/assert.ts";
import {
  normalizeByteSource,
  RandomAccessReaderStream,
  read,
  readableStreamFromDeferred,
  type ByteSource,
  type ByteSourceProvider,
  type RandomAccessReader,
} from "../util/streams.ts";
import { ZipEntryReader } from "./entry.ts";
import {
  CentralDirectoryBufferReader,
  CentralDirectoryHeader,
  CentralDirectoryStreamReader,
  type CentralDirectoryReader,
} from "./raw/central-directory-header.ts";
import { LocalFileHeader } from "./raw/local-file-header.ts";
import {
  Eocdr,
  Zip64Eocdl,
  Zip64Eocdr,
  ZipTrailer,
} from "./raw/zip-trailer.ts";

/**
 * Options for {@link ZipReaderOptions.openStream}.
 */
export type OpenStreamOptions = {
  startPosition: number;
  length: number;
};

/**
 * Options for {@link ZipReader} instance.
 */
export type ZipReaderOptions = {
  /**
   * How many bytes to read from the underlying source at a time.
   */
  bufferSize?: number | undefined;
  /**
   * A custom implementation for getting a stream of data. If not provided, the
   * data will be read in chunks via the {@link RandomAccessReader}.
   */
  openStream?: ((options: OpenStreamOptions) => ByteSource) | undefined;
};

/**
 * An object which can read a zip file from a {@link RandomAccessReader}.
 */
export class ZipReader
  implements AsyncDisposable, AsyncIterable<ZipEntryReader>, Disposable
{
  public static readonly DefaultBufferSize = 1024 * 1024;
  // we need to be able to read a whole directory header at a time
  public static readonly MinBufferSize = CentralDirectoryHeader.MaxLength;

  readonly #bufferSize: number;
  readonly #fileSize: number;
  readonly #reader: RandomAccessReader;

  readonly #openStream:
    | ((options: OpenStreamOptions) => ByteSource)
    | undefined;

  #directory: CentralDirectoryReader | undefined;
  #pendingOpen: Promise<CentralDirectoryReader> | undefined;

  /**
   * Get the file comment, if set.
   */
  public get comment(): string {
    return this.directory.comment;
  }

  /**
   * Get the zip's central directory. You must call {@link ZipReader.open}
   * first.
   */
  public get directory(): CentralDirectoryReader {
    assert(this.#directory, `call open() first`);
    return this.#directory;
  }

  /**
   * Get the total number of entries in the zip.
   */
  public get entryCount(): number {
    return this.directory.entryCount;
  }

  public constructor(
    reader: RandomAccessReader,
    fileSize: number,
    options: ZipReaderOptions = {},
  ) {
    this.#bufferSize = options.bufferSize ?? ZipReader.DefaultBufferSize;
    this.#fileSize = fileSize;
    this.#reader = reader;
    this.#openStream = options.openStream;

    assert(
      this.#bufferSize >= ZipReader.MinBufferSize,
      `buffer size must be at least ${Eocdr.MaxLength + Zip64Eocdl.RecordLength} bytes`,
    );
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryReader, void, void> {
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
    if (Symbol.asyncDispose in this.#reader) {
      await (this.#reader as AsyncDisposable)[Symbol.asyncDispose]();
    } else if (Symbol.dispose in this.#reader) {
      (this.#reader as Disposable)[Symbol.dispose]();
    } else if (this.#reader.close) {
      this.#reader.close();
    }
  }

  /**
   * Get an iterator which iterates over the file entries in the zip.
   */
  public async *files(): AsyncIterableIterator<ZipEntryReader, void, void> {
    const directory = await this.open();

    for await (const header of directory) {
      yield new ZipEntryReader(header, this.makeEntryStreamProvider(header));
    }
  }

  /**
   * Open the file and initialize the instance state.
   */
  public async open(): Promise<CentralDirectoryReader> {
    if (this.#directory) {
      return this.#directory;
    }
    if (!this.#pendingOpen) {
      this.#pendingOpen = this.#readCentralDirectory();
    }
    this.#directory = await this.#pendingOpen;
    return this.#directory;
  }

  protected makeEntryStreamProvider(
    entry: CentralDirectoryHeader,
  ): ByteSourceProvider {
    let localHeaderLength: number | undefined;
    let pendingLocalHeaderLength: Promise<number> | undefined;

    const readLocalHeaderLength = async (): Promise<number> => {
      const buffer = new Uint8Array(LocalFileHeader.MinLength);

      await read(this.#reader, {
        buffer,
        minLength: LocalFileHeader.MinLength,
        position: entry.localHeaderOffset,
      });

      localHeaderLength = LocalFileHeader.readHeaderLength(buffer);
      return localHeaderLength;
    };

    return () => {
      if (localHeaderLength !== undefined) {
        return this.openStream({
          length: entry.compressedSize,
          startPosition: entry.localHeaderOffset + localHeaderLength,
        });
      }
      pendingLocalHeaderLength ??= readLocalHeaderLength();

      return readableStreamFromDeferred(
        pendingLocalHeaderLength.then((localHeaderLength) =>
          this.openStream({
            length: entry.compressedSize,
            startPosition: entry.localHeaderOffset + localHeaderLength,
          }),
        ),
      );
    };
  }

  protected openDirectoryStream(trailer: ZipTrailer): ByteSource {
    return this.openStream({
      length: trailer.directoryLength,
      startPosition: trailer.directoryStart,
    });
  }

  protected openStream(options: OpenStreamOptions): ReadableStream<Uint8Array> {
    if (this.#openStream) {
      return normalizeByteSource(this.#openStream(options));
    }
    return new RandomAccessReaderStream({
      bufferSize: this.#bufferSize,
      length: options.length,
      reader: this.#reader,
      startPosition: options.startPosition,
    });
  }

  async #readCentralDirectory(): Promise<CentralDirectoryReader> {
    // read up to the buffer size to try find all of the trailer
    let bufferSize = Math.min(this.#fileSize, this.#bufferSize);
    let position = this.#fileSize - bufferSize;

    const buffer = new Uint8Array(bufferSize);

    await read(this.#reader, {
      buffer,
      position,
      minLength: bufferSize,
    });

    const eocdrOffset = Eocdr.findOffset(buffer);
    const eocdr = Eocdr.deserialize(buffer, eocdrOffset);
    const eocdl = Zip64Eocdl.find(buffer, eocdrOffset);

    if (!eocdl) {
      const trailer = new ZipTrailer(eocdr);

      if (eocdr.directoryStart >= position) {
        // we already read all of the central directory into the buffer
        return new CentralDirectoryBufferReader(
          trailer,
          buffer,
          eocdr.directoryStart - position,
        );
      }

      // we don't have the whole directory, so stream it instead
      return new CentralDirectoryStreamReader(trailer, () =>
        this.openDirectoryStream(trailer),
      );
    }

    let zip64eocdr: Zip64Eocdr;
    if (eocdl.eocdrOffset < position) {
      // We didn't manage to read the zip64 eocdr within the original buffer,
      // so read again from the EOCDL offset. We attempt again to read the
      // whole central directory in one chunk, so we'll read from a position
      // that puts the ECODR at the _end_ of the buffer.

      const endPosition = eocdl.eocdrOffset + Zip64Eocdr.MinLength;
      bufferSize = Math.min(this.#bufferSize, endPosition);
      position = endPosition - bufferSize;

      await read(this.#reader, {
        buffer,
        position,
        minLength: bufferSize,
      });

      // read the EOCDR from the end of the buffer
      zip64eocdr = Zip64Eocdr.deserialize(
        buffer,
        bufferSize - Zip64Eocdr.MinLength,
      );
    } else {
      zip64eocdr = Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset - position);
    }

    const trailer = new ZipTrailer(eocdr, zip64eocdr);

    if (zip64eocdr.directoryStart >= position) {
      const bufferOffset = zip64eocdr.directoryStart - position;
      if (bufferOffset + zip64eocdr.directoryLength < bufferSize) {
        // we have the whole EOCDR in the buffer
        return new CentralDirectoryBufferReader(trailer, buffer, bufferOffset);
      }
    }
    // we don't have the whole directory, so stream it instead
    return new CentralDirectoryStreamReader(trailer, () =>
      this.openDirectoryStream(trailer),
    );
  }
}
