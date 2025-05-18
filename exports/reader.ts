import { assert } from "../util/assert.ts";
import { read, type RandomAccessReader } from "../util/streams.ts";
import { ZipEntryReader } from "./entry.ts";
import {
  CentralDirectoryBufferReader,
  CentralDirectoryHeader,
  CentralDirectoryRandomAccessReader,
  type CentralDirectoryReader,
} from "./raw/central-directory-header.ts";
import {
  Eocdr,
  Zip64Eocdl,
  Zip64Eocdr,
  ZipTrailer,
} from "./raw/zip-trailer.ts";

/**
 * Options for {@link ZipReader} instance.
 */
export type ZipReaderOptions = {
  bufferSize?: number | undefined;
};

/**
 * An object which can read a zip file from a {@link RandomAccessReader}.
 */
export class ZipReader
  implements AsyncDisposable, AsyncIterable<ZipEntryReader>, Disposable
{
  public static readonly DefaultBufferSize = 1024 * 1024;
  // we need to be able to read a whole directory header at a time
  public static readonly MinBufferSize = CentralDirectoryHeader.MaxSize;

  readonly #bufferSize: number;
  readonly #fileSize: number;
  readonly #reader: RandomAccessReader;

  #directory: CentralDirectoryReader | undefined;
  #pendingOpen: Promise<CentralDirectoryReader> | undefined;

  /**
   * Get the file comment, if set.
   */
  public get comment(): string {
    assert(this.#directory, `call open() first`);
    return this.#directory.comment;
  }

  /**
   * Get the total number of entries in the zip.
   */
  public get entryCount(): number {
    assert(this.#directory, `call open() first`);
    return this.#directory.count;
  }

  public constructor(
    reader: RandomAccessReader,
    fileSize: number,
    options: ZipReaderOptions = {},
  ) {
    this.#bufferSize = options.bufferSize ?? ZipReader.DefaultBufferSize;
    this.#fileSize = fileSize;
    this.#reader = reader;

    assert(
      this.#bufferSize >= ZipReader.MinBufferSize,
      `buffer size must be at least ${Eocdr.MaxSize + Zip64Eocdl.FixedSize}`,
    );
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
  public async *files(): AsyncGenerator<ZipEntryReader> {
    const directory = await this.open();

    for await (const entry of directory) {
      yield ZipEntryReader.fromRandomAccessReader(
        entry,
        this.#reader,
        this.#bufferSize,
      );
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
      if (eocdr.offset >= position) {
        // we already read all of the central directory into the buffer
        return new CentralDirectoryBufferReader(
          new ZipTrailer(eocdr),
          buffer,
          eocdr.offset - position,
        );
      }
      // we don't have the whole directory, so stream it instead
      return new CentralDirectoryRandomAccessReader(new ZipTrailer(eocdr), {
        reader: this.#reader,
        bufferSize: this.#bufferSize,
      });
    }

    let zip64eocdr: Zip64Eocdr;
    if (eocdl.eocdrOffset < position) {
      // We didn't manage to read the zip64 eocdr within the original buffer,
      // so read again from the EOCDL offset. We attempt again to read the
      // whole central directory in one chunk, so we'll read from a position
      // that puts the ECODR at the _end_ of the buffer.

      const endPosition = eocdl.eocdrOffset + Zip64Eocdr.FixedSize;
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
        bufferSize - Zip64Eocdr.FixedSize,
      );
    } else {
      zip64eocdr = Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset - position);
    }

    const trailer = new ZipTrailer(eocdr, zip64eocdr);

    if (zip64eocdr.offset >= position) {
      const bufferOffset = zip64eocdr.offset - position;
      if (bufferOffset + zip64eocdr.size < bufferSize) {
        // we have the whole EOCDR in the buffer
        return new CentralDirectoryBufferReader(trailer, buffer, bufferOffset);
      }
    }
    // we don't have the whole directory, so stream it instead
    return new CentralDirectoryRandomAccessReader(trailer, {
      reader: this.#reader,
      bufferSize: this.#bufferSize,
    });
  }
}
