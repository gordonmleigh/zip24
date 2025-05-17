import { BufferView, type BufferLike } from "../util/binary.ts";
import { ZipEntryReader } from "./entry.ts";
import { CentralDirectoryHeader } from "./raw/central-directory-header.ts";
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
  private readonly buffer: BufferView;
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

  public constructor(buffer: BufferLike) {
    this.buffer = new BufferView(buffer);

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
      const header = CentralDirectoryHeader.deserialize(this.buffer, offset);
      offset += header.totalSize;

      const localHeaderSize = LocalFileHeader.readTotalSize(
        this.buffer,
        header.localHeaderOffset,
      );

      yield ZipEntryReader.fromBuffer(
        header,
        this.buffer.getOriginalBytes(
          header.localHeaderOffset + localHeaderSize,
          header.compressedSize,
        ),
      );
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
