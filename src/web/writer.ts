import {
  CompressionMethod,
  compress,
  type CompressionAlgorithms,
  type DataDescriptor,
} from "../core/compression-core.js";
import { ZipPlatform, ZipVersion } from "../core/constants.js";
import { writeDirectoryHeader } from "../core/directory-entry.js";
import {
  minimumVersion,
  needs64bit,
  needsDataDescriptor,
  needsUtf8,
} from "../core/entry-utils.js";
import {
  getAttributesPlatform,
  makePlatformAttributes,
} from "../core/file-attributes.js";
import { GeneralPurposeFlags } from "../core/flags.js";
import {
  writeDataDescriptor32,
  writeDataDescriptor64,
  writeLocalHeader,
} from "../core/local-entry.js";
import type {
  RawCentralHeader,
  RawLocalHeader,
  ZipEntryInfo,
  ZipEntryOptions,
} from "../core/records.js";
import { Eocdr, Zip64Eocdl, Zip64Eocdr } from "../core/zip-trailer.js";
import { CodePage437Encoder } from "../util/cp437.js";
import {
  ByteLengthStrategy,
  DoubleEndedBuffer,
} from "../util/double-ended-buffer.js";
import { Semaphore } from "../util/semaphore.js";
import type { DataSource } from "../util/streams.js";
import { defaultCompressors } from "./compression.js";

type ZipEntryInternalOptions = ZipEntryOptions & {
  hasDataDescriptor?: boolean;
};

type InternalHeader = RawCentralHeader & { zip64?: boolean };

export type ZipWriterOptions = {
  compressors?: CompressionAlgorithms;
  highWaterMark?: number;
  startingOffset?: number;
};

export class ZipWriter implements AsyncIterable<Uint8Array> {
  private readonly buffer: DoubleEndedBuffer<Uint8Array>;
  private readonly bufferSemaphore = new Semaphore(1);
  private readonly compressors: CompressionAlgorithms;
  private readonly directory: InternalHeader[] = [];
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
    const attributes =
      file.attributes ??
      makePlatformAttributes(file.platformMadeBy ?? ZipPlatform.DOS);
    const platform = getAttributesPlatform(attributes);
    const hasDataDescriptor = needsDataDescriptor(file);
    const utf8 = !!file.utf8 || needsUtf8(file);
    const zip64 = !!file.zip64 || needs64bit({ ...file, localHeaderOffset });
    const options = { hasDataDescriptor, utf8, zip64 };
    const version = minimumVersion(options, file.versionMadeBy);

    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = hasDataDescriptor;
    flags.hasUtf8Strings = utf8;

    const encoder = utf8 ? new TextEncoder() : new CodePage437Encoder();

    const localHeader: RawLocalHeader = {
      compressedSize: file.compressedSize ?? 0,
      compressionMethod: file.compressionMethod ?? CompressionMethod.Deflate,
      crc32: file.crc32 ?? 0,
      flags,
      lastModified: file.lastModified ?? new Date(),
      path: encoder.encode(file.path),
      uncompressedSize: file.uncompressedSize ?? 0,
      versionNeeded: version,
    };

    await this.buffer.write(writeLocalHeader(localHeader, { zip64 }));

    const dataDescriptor = await this.writeFileData(
      localHeader.compressionMethod,
      file,
      content,
      options,
    );

    const directoryHeader: InternalHeader = {
      ...localHeader,
      ...dataDescriptor,
      ...options,
      attributes,
      comment: encoder.encode(file.comment),
      localHeaderOffset,
      internalAttributes: 0,
      platformMadeBy: platform,
      versionMadeBy: version,
      zip64,
    };

    this.directory.push(directoryHeader);
  }

  private async writeCentralDirectory(fileComment?: string): Promise<void> {
    const directoryOffset = this.startingOffset + this.buffer.written;
    let useZip64 = this.directory.length > 0xffff;
    let versionNeeded = ZipVersion.Deflate;

    for (const { zip64, ...entry } of this.directory) {
      useZip64 ||= !!zip64;
      versionNeeded = Math.max(versionNeeded, entry.versionNeeded);
      await this.buffer.write(writeDirectoryHeader(entry, { zip64 }));
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

  private async writeFileData(
    compressionMethod: CompressionMethod,
    checkValues: Partial<DataDescriptor> = {},
    content: DataSource | undefined,
    options: ZipEntryInternalOptions,
  ): Promise<DataDescriptor> {
    const descriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    await this.buffer.pipeFrom(
      compress(
        compressionMethod,
        checkValues,
        descriptor,
        content,
        this.compressors,
      ),
    );

    if (options.hasDataDescriptor) {
      if (options.zip64) {
        await this.buffer.write(writeDataDescriptor64(descriptor));
      } else {
        await this.buffer.write(writeDataDescriptor32(descriptor));
      }
    }

    return descriptor;
  }
}
