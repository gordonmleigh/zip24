import { CentralDirectoryHeader } from "../core/central-directory-header.js";
import {
  CompressionMethod,
  compress,
  type CompressionAlgorithms,
} from "../core/compression-core.js";
import { ZipPlatform, ZipVersion } from "../core/constants.js";
import { DataDescriptor } from "../core/data-descriptor.js";
import { LocalFileHeader } from "../core/local-file-header.js";
import { ZipEntry, type ZipEntryInfo } from "../core/zip-entry.js";
import { Eocdr, Zip64Eocdl, Zip64Eocdr } from "../core/zip-trailer.js";
import {
  ByteLengthStrategy,
  DoubleEndedBuffer,
} from "../util/double-ended-buffer.js";
import { Semaphore } from "../util/semaphore.js";
import type { DataSource } from "../util/streams.js";
import { defaultCompressors } from "./compression.js";

export type ZipWriterOptions = {
  compressors?: CompressionAlgorithms;
  highWaterMark?: number;
  startingOffset?: number;
};

export class ZipWriter implements AsyncIterable<Uint8Array> {
  private readonly buffer: DoubleEndedBuffer<Uint8Array>;
  private readonly bufferSemaphore = new Semaphore(1);
  private readonly compressors: CompressionAlgorithms;
  private readonly directory: CentralDirectoryHeader[] = [];
  private readonly startingOffset: number;

  public constructor(options: ZipWriterOptions = {}) {
    const { compressors, highWaterMark = 0xa000, startingOffset = 0 } = options;

    // the buffer stores outgoing data chunks
    this.buffer = new DoubleEndedBuffer(new ByteLengthStrategy(highWaterMark));
    this.compressors = compressors ?? defaultCompressors;
    this.startingOffset = startingOffset;
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.buffer;
  }

  public readonly addFile = this.bufferSemaphore.synchronize(
    (file: ZipEntryInfo, content?: DataSource) =>
      this.writeFileEntry(file, content),
  );

  public readonly finalize = this.bufferSemaphore.synchronize(
    async (fileComment?: string) => {
      await this.writeCentralDirectory(fileComment);
      this.buffer.end();
      await this.buffer.ended;
    },
  );

  private async writeFileEntry(
    file: ZipEntryInfo,
    content?: DataSource,
  ): Promise<void> {
    const localHeaderOffset = this.startingOffset + this.buffer.written;

    // normalize the options
    const entry = new ZipEntry({
      ...file,
      compressionMethod:
        file.compressionMethod ??
        (content === undefined || content === ""
          ? CompressionMethod.Stored
          : CompressionMethod.Deflate),
      localHeaderOffset,
      uncompressedData: content,
    });

    const hasDataDescriptor = entry.flags.hasDataDescriptor;

    const localHeader = new LocalFileHeader({
      compressedSize: hasDataDescriptor ? 0 : entry.compressedSize,
      compressionMethod: entry.compressionMethod,
      crc32: hasDataDescriptor ? 0 : entry.crc32,
      extraField: entry.extraField,
      flags: entry.flags,
      lastModified: entry.lastModified,
      path: entry.path,
      uncompressedSize: hasDataDescriptor ? 0 : entry.uncompressedSize,
      versionNeeded: entry.versionNeeded,
      zip64: entry.zip64,
    });

    const dataDescriptor = new DataDescriptor(undefined, entry.zip64);
    await this.buffer.write(localHeader.serialize());

    await this.buffer.pipeFrom(
      compress(
        entry.compressionMethod,
        file,
        dataDescriptor,
        content,
        this.compressors,
      ),
    );

    if (hasDataDescriptor) {
      await this.buffer.write(dataDescriptor.serialize());
    }

    this.directory.push(
      new CentralDirectoryHeader({
        attributes: entry.attributes,
        comment: entry.comment,
        compressedSize: dataDescriptor.compressedSize,
        compressionMethod: entry.compressionMethod,
        crc32: dataDescriptor.crc32,
        extraField: entry.extraField,
        flags: entry.flags,
        lastModified: entry.lastModified,
        localHeaderOffset,
        path: entry.path,
        uncompressedSize: dataDescriptor.uncompressedSize,
        versionMadeBy: entry.versionMadeBy,
        versionNeeded: entry.versionNeeded,
        zip64: entry.zip64,
      }),
    );
  }

  private async writeCentralDirectory(fileComment?: string): Promise<void> {
    const directoryOffset = this.startingOffset + this.buffer.written;
    let useZip64 = this.directory.length > 0xffff;
    let versionNeeded = ZipVersion.Deflate;

    for (const header of this.directory) {
      useZip64 ||= !!header.zip64;
      versionNeeded = Math.max(versionNeeded, header.versionNeeded);
      await this.buffer.write(header.serialize());
    }

    const trailerOffset = this.startingOffset + this.buffer.written;
    const directorySize = trailerOffset - directoryOffset;
    useZip64 ||= trailerOffset >= 0xffff_ffff;

    if (useZip64) {
      const eocdr64 = new Zip64Eocdr({
        count: this.directory.length,
        offset: directoryOffset,
        size: directorySize,
        platformMadeBy: ZipPlatform.UNIX,
        versionMadeBy: versionNeeded,
        versionNeeded,
      });

      await this.buffer.write(eocdr64.serialize());
      await this.buffer.write(new Zip64Eocdl(trailerOffset).serialize());
    }

    const eocdr = new Eocdr(
      {
        comment: fileComment ?? "",
        count: this.directory.length,
        offset: directoryOffset,
        size: directorySize,
      },
      useZip64,
    );

    await this.buffer.write(eocdr.serialize());
  }
}
