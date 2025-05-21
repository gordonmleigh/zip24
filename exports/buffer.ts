import { BufferView, type BufferLike } from "../util/binary.ts";
import { ZipEntryReader } from "./entry.ts";
import { CentralDirectoryBufferReader } from "./raw/central-directory-header.ts";
import { LocalFileHeader } from "./raw/local-file-header.ts";
import {
  Eocdr,
  Zip64Eocdl,
  Zip64Eocdr,
  ZipTrailer,
} from "./raw/zip-trailer.ts";

/**
 * An object which can read zip data from a buffer.
 */
export class ZipBufferReader
  implements AsyncIterable<ZipEntryReader>, Iterable<ZipEntryReader>
{
  readonly #buffer: BufferView;
  readonly #directory: CentralDirectoryBufferReader;

  /**
   * The zip file comment, if set.
   */
  public get comment(): string {
    return this.#directory.comment;
  }

  /**
   * The number of file entries in the zip.
   */
  public get entryCount(): number {
    return this.#directory.count;
  }

  public constructor(buffer: BufferLike) {
    this.#buffer = new BufferView(buffer);

    const eocdrOffset = Eocdr.findOffset(buffer);
    const eocdr = Eocdr.deserialize(buffer, eocdrOffset);
    const eocdl = Zip64Eocdl.find(buffer, eocdrOffset);
    const eocdr64 = eocdl && Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset);
    const trailer = new ZipTrailer(eocdr, eocdr64);

    this.#directory = new CentralDirectoryBufferReader(
      trailer,
      buffer,
      trailer.offset,
    );
  }

  /**
   * Iterate through the files in the zip synchronously.
   */
  public *filesSync(): IterableIterator<ZipEntryReader, void, void> {
    for (const entry of this.#directory) {
      const localHeaderSize = LocalFileHeader.readTotalSize(
        this.#buffer,
        entry.localHeaderOffset,
      );

      yield new ZipEntryReader(
        entry,
        this.#buffer.getOriginalBytes(
          entry.localHeaderOffset + localHeaderSize,
          entry.compressedSize,
        ),
      );
    }
  }

  /**
   * Iterate through the files in the zip.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface
  public async *files(): AsyncIterableIterator<ZipEntryReader, void, void> {
    yield* this.filesSync();
  }

  public [Symbol.iterator](): Iterator<ZipEntryReader, void, void> {
    return this.filesSync();
  }

  public [Symbol.asyncIterator](): AsyncIterator<ZipEntryReader, void, void> {
    return this.files();
  }
}
