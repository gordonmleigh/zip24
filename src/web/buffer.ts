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
import { BufferView, type BufferLike } from "../util/binary.js";
import { defaultDecompressors } from "./compression.js";

/**
 * Options for {@link ZipBufferEntryReader}.
 */
export type ZipBufferReaderOptions = {
  decompressors?: CompressionAlgorithms;
};

/**
 * An object which can read zip data from a buffer.
 */
export class ZipBufferReader {
  private readonly buffer: BufferView;
  private readonly decompressors: CompressionAlgorithms;
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

  public constructor(buffer: BufferLike, options: ZipBufferReaderOptions = {}) {
    this.buffer = new BufferView(buffer);
    this.decompressors = options.decompressors ?? defaultDecompressors;

    const eocdrOffset = Eocdr.findOffset(buffer);
    const eocdr = Eocdr.deserialize(buffer, eocdrOffset);
    const eocdl = Zip64Eocdl.find(buffer, eocdrOffset);
    const eocdr64 = eocdl && Zip64Eocdr.deserialize(buffer, eocdl.eocdrOffset);

    this.trailer = new ZipTrailer(eocdr, eocdr64);
  }

  /**
   * Iterate through the files in the zip synchronously.
   */
  public *filesSync(): Generator<ZipEntry> {
    let offset = this.trailer.offset;

    for (let index = 0; index < this.entryCount; ++index) {
      const header = CentralDirectoryHeader.deserialize(this.buffer, offset);
      offset += header.totalSize;

      const localHeaderSize = LocalFileHeader.readTotalSize(
        this.buffer,
        header.localHeaderOffset,
      );

      const compressedData = this.buffer.getOriginalBytes(
        header.localHeaderOffset + localHeaderSize,
        header.compressedSize,
      );

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

        uncompressedData: decompress(
          header.compressionMethod,
          header,
          [compressedData],
          this.decompressors,
        ),

        noValidateVersion: true,
      });

      yield entry;
    }
  }

  /**
   * Iterate through the files in the zip.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface
  public async *files(): AsyncGenerator<ZipEntry> {
    yield* this.filesSync();
  }

  public [Symbol.iterator](): Iterator<ZipEntry> {
    return this.filesSync();
  }

  public [Symbol.asyncIterator](): AsyncIterator<ZipEntry> {
    return this.files();
  }
}
