import { writeZipTrailer } from "../internal/central-directory.js";
import {
  CompressionMethod,
  compress,
  type CompressionAlgorithms,
  type DataDescriptor,
} from "../internal/compression-core.js";
import { ZipPlatform, ZipVersion } from "../internal/constants.js";
import { CodePage437Encoder } from "../internal/cp437.js";
import { writeDirectoryHeader } from "../internal/directory-entry.js";
import {
  ByteLengthStrategy,
  DoubleEndedBuffer,
} from "../internal/double-ended-buffer.js";
import {
  minimumVersion,
  needs64bit,
  needsDataDescriptor,
  needsUtf8,
} from "../internal/entry-utils.js";
import {
  GeneralPurposeFlags,
  type ZipEntryInfo,
  type ZipEntryOptions,
} from "../internal/field-types.js";
import {
  getAttributesPlatform,
  makePlatformAttributes,
} from "../internal/file-attributes.js";
import {
  writeDataDescriptor32,
  writeDataDescriptor64,
  writeLocalHeader,
} from "../internal/local-entry.js";
import type {
  CentralDirectory64VersionInfo,
  RawCentralHeader,
  RawLocalHeader,
} from "../internal/records.js";
import { Semaphore } from "../internal/semaphore.js";
import type { DataSource } from "../internal/streams.js";
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

    let zip64: CentralDirectory64VersionInfo | undefined;

    if (useZip64) {
      zip64 = {
        platformMadeBy: ZipPlatform.UNIX,
        versionMadeBy: versionNeeded,
        versionNeeded,
      };
    }

    await this.buffer.write(
      writeZipTrailer(
        {
          comment: fileComment ?? "",
          count: this.directory.length,
          offset: directoryOffset,
          size: directorySize,
          zip64,
        },
        trailerOffset,
      ),
    );
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
