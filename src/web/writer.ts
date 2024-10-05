import { ZipEntry, ZipPlatform, ZipVersion } from "../common.js";
import { CentralDirectoryHeader } from "../core/central-directory-header.js";
import {
  compress,
  CompressionMethod,
  type CompressionAlgorithms,
} from "../core/compression-core.js";
import { DataDescriptor } from "../core/data-descriptor.js";
import { LocalFileHeader } from "../core/local-file-header.js";
import type { ZipEntryInfo } from "../core/zip-entry.js";
import { Eocdr, Zip64Eocdl, Zip64Eocdr } from "../core/zip-trailer.js";
import {
  DoubleEndedBuffer,
  type DoubleEndedBufferOptions,
} from "../util/double-ended-buffer.js";
import { Mutex } from "../util/mutex.js";
import type { ByteSink, DataSource } from "../util/streams.js";
import { defaultCompressors } from "./compression.js";

export type ZipWriterOptionsBase = {
  compressors?: CompressionAlgorithms;
  startingOffset?: number;
};

export type ZipStreamWriterOptions = ZipWriterOptionsBase & {
  sink: ByteSink;
};

export type ZipBufferWriterOptions = ZipWriterOptionsBase &
  DoubleEndedBufferOptions;

export type ZipWriterOptions = ZipStreamWriterOptions | ZipBufferWriterOptions;

export class ZipWriter implements AsyncDisposable, AsyncIterable<Uint8Array> {
  public static fromWritableStream(
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    stream: WritableStream,
    options?: ZipWriterOptionsBase,
  ): ZipWriter {
    return new ZipWriter({
      ...options,
      sink: stream.getWriter(),
    });
  }

  private readonly buffer: DoubleEndedBuffer | undefined;
  private readonly compressors: CompressionAlgorithms;
  private readonly directory: CentralDirectoryHeader[] = [];
  private readonly sink: ByteSink;
  private readonly startingOffset: number;
  private readonly writeLock = new Mutex();

  private isFinalized = false;
  private writtenBytes = 0;

  public constructor(options: ZipWriterOptions = {}) {
    const {
      compressors = defaultCompressors,
      highWaterMark,
      sink = new DoubleEndedBuffer({ highWaterMark }),
      startingOffset = 0,
    } = options as Partial<ZipStreamWriterOptions & ZipBufferWriterOptions>;

    if (sink instanceof DoubleEndedBuffer) {
      this.buffer = sink;
    }

    this.compressors = compressors;
    this.sink = sink;
    this.startingOffset = startingOffset;
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    if (this.buffer === undefined) {
      throw new Error(`reading is not supported when initialized with sink`);
    }
    yield* this.buffer;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.sink.close();
  }

  /**
   * Add a file to the Zip.
   */
  public readonly addFile = this.writeLock.synchronize(
    async (file: ZipEntryInfo, content?: DataSource) => {
      if (this.isFinalized) {
        throw new Error(`can't add more files after calling finalize()`);
      }
      await this.writeFileEntry(file, content);
    },
  );

  /**
   * Finalize the zip with an optional comment.
   */
  public readonly finalize = this.writeLock.synchronize(
    async (fileComment?: string) => {
      if (this.isFinalized) {
        throw new Error(`multiple calls to finalize()`);
      }
      this.isFinalized = true;
      await this.writeCentralDirectory(fileComment);
      await this.sink.close();
    },
  );

  private async write(chunk: Uint8Array): Promise<void> {
    await this.sink.write(chunk);
    this.writtenBytes += chunk.byteLength;
  }

  private async writeFileEntry(
    file: ZipEntryInfo,
    content?: DataSource,
  ): Promise<void> {
    const localHeaderOffset = this.startingOffset + this.writtenBytes;

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
    await this.write(localHeader.serialize());

    const compressedData = compress(
      entry.compressionMethod,
      file,
      dataDescriptor,
      content,
      this.compressors,
    );
    for await (const chunk of compressedData) {
      await this.write(chunk);
    }

    if (hasDataDescriptor) {
      await this.write(dataDescriptor.serialize());
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
    const directoryOffset = this.startingOffset + this.writtenBytes;
    let useZip64 = this.directory.length > 0xffff;
    let versionNeeded = ZipVersion.Deflate;

    for (const header of this.directory) {
      useZip64 ||= !!header.zip64;
      versionNeeded = Math.max(versionNeeded, header.versionNeeded);
      await this.write(header.serialize());
    }

    const trailerOffset = this.startingOffset + this.writtenBytes;
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

      await this.write(eocdr64.serialize());
      await this.write(new Zip64Eocdl(trailerOffset).serialize());
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

    await this.write(eocdr.serialize());
  }
}
