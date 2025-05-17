import { assert } from "../util/assert.ts";
import type { RandomAccessReader } from "../util/streams.ts";
import { CentralDirectoryHeader } from "./raw/central-directory-header.ts";
import {
  Eocdr,
  Zip64Eocdl,
  Zip64Eocdr,
  ZipTrailer,
} from "./raw/zip-trailer.ts";
import { ZipEntryReader } from "./zip-entry.ts";

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
  public static readonly DefaultBufferSize = 1024 ** 2;

  readonly #bufferSize: number;
  readonly #fileSize: number;
  readonly #reader: RandomAccessReader;

  #pendingOpen: Promise<void> | undefined;
  #trailer: ZipTrailer | undefined;

  /**
   * Get the file comment, if set.
   */
  public get comment(): string {
    assert(this.#trailer, `call open() first`);
    return this.#trailer.comment;
  }

  /**
   * Get the total number of entries in the zip.
   */
  public get entryCount(): number {
    assert(this.#trailer, `call open() first`);
    return this.#trailer.count;
  }

  public constructor(
    reader: RandomAccessReader,
    fileSize: number,
    options: ZipReaderOptions = {},
  ) {
    this.#bufferSize = options.bufferSize ?? ZipReader.DefaultBufferSize;
    this.#fileSize = fileSize;
    this.#reader = reader;
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
    await this.open();
    assert(this.#trailer, `expected this.directory to have a value`);

    const buffer = new Uint8Array(this.#bufferSize);

    let position = this.#trailer.offset;
    let offset = 0;
    let bufferLength = 0;

    const ensureBuffer = async (length: number): Promise<void> => {
      assert(
        length <= buffer.byteLength,
        `the configured buffer size (${this.#bufferSize}) is too small to read the full entry (${length})`,
      );

      if (offset + length > bufferLength) {
        // there isn't enough buffer left to read all of the variable fields, so
        // read a new chunk starting from the current file offset (position + offset)
        position = position - bufferLength + offset;
        offset = 0;

        const result = await this.#reader.read({ buffer, position });
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
      offset += headerLength;

      yield ZipEntryReader.fromRandomAccessReader(
        header,
        this.#reader,
        this.#bufferSize,
      );
    }
  }

  /**
   * Open the file and initialize the instance state.
   */
  public async open(): Promise<void> {
    if (this.#trailer) {
      return;
    }
    if (this.#pendingOpen) {
      await this.#pendingOpen;
      return;
    }

    let complete!: () => void;
    this.#pendingOpen = new Promise((resolve) => {
      complete = resolve;
    });

    // read up to the buffer size to try find all of the trailer
    const bufferSize = Math.min(this.#fileSize, this.#bufferSize);
    const position = this.#fileSize - bufferSize;

    const buffer = new Uint8Array(bufferSize);
    const readResult = await this.#reader.read({ buffer, position });
    assert(readResult.bytesRead === bufferSize, `unexpected end of file`);

    const eocdrOffset = Eocdr.findOffset(buffer);
    const eocdr = Eocdr.deserialize(buffer, eocdrOffset);
    const eocdl = Zip64Eocdl.find(buffer, eocdrOffset);

    if (eocdl) {
      if (eocdl.eocdrOffset < position) {
        // we didn't manage to read the zip64 eocdr within the original buffer
        const readResult = await this.#reader.read({
          buffer,
          position: eocdl.eocdrOffset,
          length: Zip64Eocdr.FixedSize,
        });

        assert(
          readResult.bytesRead === Zip64Eocdr.FixedSize,
          `unexpected end of file`,
        );

        this.#trailer = new ZipTrailer(
          eocdr,
          Zip64Eocdr.deserialize(buffer, 0),
        );
      } else {
        this.#trailer = new ZipTrailer(
          eocdr,
          Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset - position),
        );
      }
    } else {
      this.#trailer = new ZipTrailer(eocdr);
    }
    complete();
  }
}
