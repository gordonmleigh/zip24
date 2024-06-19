import { assert } from "../internal/assert.js";
import { BufferView } from "../internal/binary.js";
import {
  CodePage437Encoder,
  canBeCodePage437Encoded,
} from "../internal/cp437.js";
import { computeCrc32 } from "../internal/crc32.js";
import { writeDirectoryHeader } from "../internal/directory-entry.js";
import {
  ByteLengthStrategy,
  DoubleEndedBuffer,
} from "../internal/double-ended-buffer.js";
import {
  CompressionMethod,
  GeneralPurposeFlags,
  ZipPlatform,
  ZipVersion,
  makePlatformAttributes,
  type CompressionAlgorithms,
} from "../internal/field-types.js";
import { writeLocalHeader } from "../internal/local-entry.js";
import type {
  CompressionInfoFields,
  DataDescriptor,
  DecodedCentralHeader,
  RawCentralHeader,
  RawLocalHeader,
  Zip64ExtraField,
} from "../internal/records.js";
import { Semaphore } from "../internal/semaphore.js";
import {
  DataDescriptorSignature,
  EndOfCentralDirectorySignature,
  Zip64EocdlSignature,
  Zip64EocdrSignature,
} from "../internal/signatures.js";
import {
  identityStream,
  iterableFromReadableStream,
  mapIterable,
} from "../internal/streams.js";
import { defaultCompressors } from "./compression.js";

export type ZipEntryOptions = {
  utf8?: boolean;
  zip64?: boolean;
};

export type ZipEntryInfo = Partial<PublicEntryFields> & ZipEntryOptions;

export type ZipEntryData =
  | Uint8Array
  | string
  | AsyncIterable<Uint8Array>
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  | ReadableStream<Uint8Array>;

type PublicEntryFields = Omit<
  DecodedCentralHeader,
  "flags" | "internalAttributes" | "localHeaderOffset" | "versionNeeded"
>;

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

  private zip64 = false;

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
    (file: ZipEntryInfo, content?: ZipEntryData) =>
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
    content?: ZipEntryData,
  ): Promise<void> {
    const localHeaderOffset = this.startingOffset + this.buffer.written;

    // normalize the options
    const platform = file.platformMadeBy ?? ZipPlatform.DOS;
    const attributes = file.attributes ?? makePlatformAttributes(platform);
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
      { ...file, compressionMethod: localHeader.compressionMethod },
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
    };

    this.zip64 ||= zip64;
    this.directory.push(directoryHeader);
  }

  private async writeCentralDirectory(fileComment?: string): Promise<void> {
    const directoryOffset = this.startingOffset + this.buffer.written;

    for (const { zip64, ...entry } of this.directory) {
      await this.buffer.write(writeDirectoryHeader(entry, { zip64 }));
    }

    const fileSize = this.startingOffset + this.buffer.written;
    const directorySize = fileSize - directoryOffset;
    const zip64 = this.zip64 || fileSize >= 0xffff_ffff;

    if (zip64) {
      await this.writeZip64EndOfCentralDirectory(
        directoryOffset,
        directorySize,
      );
      await this.writeZip64EndOfCentralDirectoryLocator(directoryOffset);
    }

    await this.writeEndOfCentralDirectory(
      directoryOffset,
      directorySize,
      zip64,
      fileComment,
    );
  }

  private async writeFileData(
    entry: Partial<CompressionInfoFields> & {
      compressionMethod: CompressionMethod;
    },
    content: ZipEntryData | undefined,
    options: ZipEntryInternalOptions,
  ): Promise<DataDescriptor> {
    // normalize the input data
    let data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
    if (typeof content === "string") {
      data = [new TextEncoder().encode(content)];
    } else if (content instanceof Uint8Array) {
      data = [content];
    } else if (content && Symbol.asyncIterator in content) {
      data = content;
    } else if (content) {
      data = iterableFromReadableStream(content);
    } else {
      data = [];
    }

    let compressor = this.compressors[entry.compressionMethod];
    if (!compressor && entry.compressionMethod === CompressionMethod.Stored) {
      compressor = identityStream;
    }
    assert(
      compressor,
      `unknown compression method ${(entry.compressionMethod as number).toString(16)}`,
    );

    const descriptor: DataDescriptor = {
      compressedSize: 0,
      crc32: 0,
      uncompressedSize: 0,
    };

    const pipeline = mapIterable(
      compressor(
        mapIterable(data, (chunk) => {
          descriptor.crc32 = computeCrc32(chunk, descriptor.crc32);
          descriptor.uncompressedSize += chunk.byteLength;
          return chunk;
        }),
      ),
      (chunk) => {
        descriptor.compressedSize += chunk.byteLength;
        return chunk;
      },
    );

    for await (const chunk of pipeline) {
      await this.buffer.write(chunk);
    }

    if (options.hasDataDescriptor) {
      if (options.zip64) {
        await this.writeDataDescriptor64(descriptor);
      } else {
        await this.writeDataDescriptor32(descriptor);
      }
    }

    if (
      (entry.compressedSize !== undefined &&
        descriptor.compressedSize !== entry.compressedSize) ||
      (entry.crc32 !== undefined && descriptor.crc32 !== entry.crc32) ||
      (entry.uncompressedSize !== undefined &&
        descriptor.uncompressedSize !== entry.uncompressedSize)
    ) {
      throw new Error(
        `compressedSize, crc32, or uncompressedSize were supplied but are invalid`,
      );
    }

    return descriptor;
  }

  private async writeDataDescriptor32(entry: DataDescriptor): Promise<void> {
    // 32-bit Data Descriptor (4.3.9)
    //
    // | offset | field                  | size |
    // | ------ | ---------------------- | ---- |
    // | 0      | signature (0x08074b50) | 4    |
    // | 4      | crc-32                 | 4    |
    // | 8      | compressed size        | 4    |
    // | 12     | uncompressed size      | 4    |
    // | 16     | (end)                  |      |
    const buffer = BufferView.alloc(16);

    buffer.writeUint32LE(DataDescriptorSignature, 0);
    buffer.writeUint32LE(entry.crc32, 4);
    buffer.writeUint32LE(entry.compressedSize, 8);
    buffer.writeUint32LE(entry.uncompressedSize, 12);

    await this.buffer.write(buffer.getOriginalBytes());
  }

  private async writeDataDescriptor64(entry: DataDescriptor): Promise<void> {
    // 64-bit Data Descriptor (4.3.9)
    //
    // | offset | field                  | size |
    // | ------ | ---------------------- | ---- |
    // | 0      | signature (0x08074b50) | 4    |
    // | 4      | crc-32                 | 4    |
    // | 8      | compressed size        | 8    |
    // | 16     | uncompressed size      | 8    |
    // | 24     | (end)                  |      |
    const buffer = BufferView.alloc(24);

    buffer.writeUint32LE(DataDescriptorSignature, 0);
    buffer.writeUint32LE(entry.crc32, 4);
    buffer.writeUint64LE(entry.compressedSize, 8);
    buffer.writeUint64LE(entry.uncompressedSize, 16);

    await this.buffer.write(buffer.getOriginalBytes());
  }

  private makeZip64ExtraField(entry: Zip64ExtraField): Uint8Array {
    // Zip64 Extended Information Extra Field (4.5.3):

    // | offset | field                          | size |
    // | ------ | ------------------------------ | ---- |
    // | 0      | tag (0x0001)                   | 2    |
    // | 2      | size                           | 2    |
    // | 4      | uncompressed size (optional)   | 8    |
    // | ...    | compressed size (optional)     | 8    |
    // | ...    | local header offset (optional) | 8    |
    // | ...    | disk number (optional)         | 4    |

    const size = entry.localHeaderOffset === undefined ? 16 : 24;

    const buffer = BufferView.alloc(size);
    buffer.writeUint16LE(0x0001, 0);
    buffer.writeUint16LE(size, 2);
    buffer.writeUint64LE(entry.uncompressedSize, 4);
    buffer.writeUint64LE(entry.compressedSize, 12);

    if (entry.localHeaderOffset !== undefined) {
      buffer.writeUint64LE(entry.localHeaderOffset, 20);
    }

    return buffer.getOriginalBytes();
  }

  private async writeZip64EndOfCentralDirectory(
    offset: number,
    size: number,
  ): Promise<void> {
    // Zip64 End of Central Directory Record (4.3.14)
    //
    // | offset | field                         | size |
    // | ------ | ----------------------------- | ---- |
    // | 0      | signature (0x06064b50)        | 4    |
    // | 4      | record size                   | 8    |
    // | 12     | version made by               | 2    |
    // | 14     | version needed to extract     | 2    |
    // | 16     | number of this disk           | 4    |
    // | 20     | central directory start disk  | 4    |
    // | 24     | total entries this disk       | 8    |
    // | 32     | total entries on all disks    | 8    |
    // | 40     | size of the central directory | 8    |
    // | 48     | central directory offset      | 8    |
    // | 56     | (end)                         |      |

    const buffer = BufferView.alloc(56);

    buffer.writeUint32LE(Zip64EocdrSignature, 0);
    buffer.writeUint64LE(56 - 12, 4); // should not include first 12 bytes
    buffer.writeUint16LE(ZipVersion.Zip64, 12);
    buffer.writeUint16LE(ZipVersion.Zip64, 14);
    buffer.writeUint32LE(0, 16);
    buffer.writeUint32LE(0, 20);
    buffer.writeUint64LE(this.directory.length, 24);
    buffer.writeUint64LE(this.directory.length, 32);
    buffer.writeUint64LE(size, 40);
    buffer.writeUint64LE(offset, 48);

    await this.buffer.write(buffer.getOriginalBytes());
  }

  private async writeZip64EndOfCentralDirectoryLocator(
    offset: number,
  ): Promise<void> {
    // Zip64 End of Central Directory Locator (4.3.15)
    //
    // | offset | field                        | size |
    // | ------ | ---------------------------- | ---- |
    // | 0      | signature (0x07064b50)       | 4    |
    // | 4      | start disk of Zip64 EOCDR    | 4    |
    // | 8      | offset of Zip64 EOCDR        | 8    |
    // | 16     | total number of disks        | 4    |
    // | 20     | (end)                        |      |

    const buffer = BufferView.alloc(20);

    buffer.setUint32(Zip64EocdlSignature, 0);
    buffer.setUint32(0, 4);
    buffer.setUint64(offset, 8);
    buffer.setUint32(1, 16);

    await this.buffer.write(buffer.getOriginalBytes());
  }

  private async writeEndOfCentralDirectory(
    offset: number,
    size: number,
    zip64: boolean,
    comment?: string,
  ): Promise<void> {
    // End of Central Directory Record (4.3.16)
    //
    // | offset | field                         | size |
    // | ------ | ----------------------------- | ---- |
    // | 0      | signature (0x06054b50)        | 4    |
    // | 4      | number of this disk           | 2    |
    // | 6      | central directory start disk  | 2    |
    // | 8      | total entries this disk       | 2    |
    // | 10     | total entries on all disks    | 2    |
    // | 12     | size of the central directory | 4    |
    // | 16     | central directory offset      | 4    |
    // | 20     | file comment length           | 2    |
    // | 22     | file comment                  | ...  |

    const commentBytes = new CodePage437Encoder().encode(comment);
    const buffer = BufferView.alloc(22 + commentBytes.length);

    buffer.writeUint32LE(EndOfCentralDirectorySignature, 0);
    buffer.writeUint16LE(zip64 ? 0xffff : 0, 4);
    buffer.writeUint16LE(zip64 ? 0xffff : 0, 6);
    buffer.writeUint16LE(zip64 ? 0xffff : this.directory.length, 8);
    buffer.writeUint16LE(zip64 ? 0xffff : this.directory.length, 10);
    buffer.writeUint32LE(zip64 ? 0xffff_ffff : size, 12);
    buffer.writeUint32LE(zip64 ? 0xffff_ffff : offset, 16);
    buffer.writeUint16LE(commentBytes.byteLength, 20);
    buffer.setBytes(22, commentBytes);

    await this.buffer.write(buffer.getOriginalBytes());
  }
}

function minimumVersion(
  options: ZipEntryOptions,
  requestedVersion?: ZipVersion,
): ZipVersion {
  const minRequired = Math.max(
    requestedVersion ?? ZipVersion.Deflate,
    options.utf8 ? ZipVersion.UtfEncoding : ZipVersion.Deflate,
    options.zip64 ? ZipVersion.UtfEncoding : ZipVersion.Deflate,
  ) as ZipVersion;

  if (requestedVersion !== undefined && requestedVersion < minRequired) {
    throw new Error(
      `versionMadeBy is explicitly set but is lower than the required value`,
    );
  }

  return minRequired;
}

function needs64bit(
  entry: Partial<Zip64ExtraField> & ZipEntryOptions,
): boolean {
  const value =
    !!entry.zip64 ||
    (entry.compressedSize ?? 0) > 0xffff_ffff ||
    (entry.uncompressedSize ?? 0) > 0xffff_ffff ||
    (entry.localHeaderOffset ?? 0) > 0xffff_ffff;

  if (entry.zip64 === false && value) {
    throw new Error(
      `zip64 is explicitly false but the entry sizes are bigger than 32 bit`,
    );
  }
  return value;
}

function needsDataDescriptor(values: Partial<DataDescriptor>): boolean {
  return (
    values.compressedSize === undefined ||
    values.crc32 === undefined ||
    values.uncompressedSize === undefined
  );
}

function needsUtf8(entry: ZipEntryInfo): boolean {
  const value =
    !!entry.utf8 ||
    (!!entry.comment && !canBeCodePage437Encoded(entry.comment)) ||
    (!!entry.path && !canBeCodePage437Encoded(entry.path));
  if (entry.utf8 === false && value) {
    throw new Error(
      `utf8 is explicitly false but the path or comment requires utf8 encoding`,
    );
  }
  return value;
}
