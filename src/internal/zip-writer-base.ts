import {
  CompressionMethod,
  DosDate,
  GeneralPurposeFlags,
  ZipPlatform,
  ZipVersion,
  type CompressionAlgorithms,
} from "../common.js";
import { assert } from "./assert.js";
import { BufferView } from "./binary.js";
import { CodePage437Encoder } from "./cp437.js";
import { computeCrc32 } from "./crc32.js";
import {
  ByteLengthStrategy,
  DoubleEndedBuffer,
  TaskQueue,
} from "./double-ended-buffer.js";
import {
  CentralHeaderSignature,
  DataDescriptorSignature,
  EndOfCentralDirectorySignature,
  LocalHeaderSignature,
  Zip64EocdlSignature,
  Zip64EocdrSignature,
} from "./signatures.js";
import {
  identityStream,
  iterableFromReadableStream,
  mapIterable,
} from "./streams.js";

type EntryInfoBase = {
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  externalFileAttributes: number;
  platformMadeBy: ZipPlatform;
  uncompressedSize: number;
  versionMadeBy: ZipVersion;
  zip64: boolean;
};

type FullEntryInfo = EntryInfoBase & {
  comment: Uint8Array;
  extraField?: Uint8Array;
  hasDataDescriptor: boolean;
  lastModified: DosDate;
  localHeaderOffset: number;
  path: Uint8Array;
};

export type ZipEntryInfo = Partial<EntryInfoBase> & {
  comment?: string;
  lastModified?: Date;
  path?: string;
};

export type ZipEntryData =
  | Uint8Array
  | string
  | AsyncIterable<Uint8Array>
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  | ReadableStream<Uint8Array>;

type DataDescriptor = {
  compressedSize: number;
  crc32: number;
  uncompressedSize: number;
};

type EntrySizes = {
  compressedSize: number;
  localHeaderOffset?: number;
  uncompressedSize: number;
};

export type ZipWriterBaseOptions = {
  compressors: CompressionAlgorithms;
  highWaterMark?: number;
  startingOffset?: number;
};

export class ZipWriterBase implements AsyncIterable<Uint8Array> {
  private readonly compressors: CompressionAlgorithms;
  private readonly directory: FullEntryInfo[] = [];
  private readonly buffer: DoubleEndedBuffer<Uint8Array>;
  private readonly queue: TaskQueue;
  private readonly startingOffset: number;

  public constructor(options: ZipWriterBaseOptions) {
    const { compressors, highWaterMark = 0xa000, startingOffset = 0 } = options;

    // the buffer stores outgoing data chunks
    this.buffer = new DoubleEndedBuffer(new ByteLengthStrategy(highWaterMark));
    // the queue synchronizes access to the buffer
    this.queue = new TaskQueue(1);

    this.compressors = compressors;
    this.startingOffset = startingOffset;

    // process items added to the queue
    this.queue.run().then(undefined, (error) => {
      // something bad happened, abort the buffer to let downstream know
      this.buffer.abort(error as Error);
    });
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.buffer;
  }

  public async writeFileEntry(
    file: ZipEntryInfo,
    content?: ZipEntryData,
  ): Promise<void> {
    await this.queue.write(() => this.writeFileEntryInternal(file, content));
  }

  public async writeCentralDirectory(fileComment?: string): Promise<void> {
    await this.queue.write(() =>
      this.writeCentralDirectoryInternal(fileComment),
    );
    await this.queue.endAndWait();
  }

  private async writeFileEntryInternal(
    file: ZipEntryInfo,
    content?: ZipEntryData,
  ): Promise<void> {
    const encoder = new TextEncoder();

    let data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
    if (typeof content === "string") {
      data = [encoder.encode(content)];
    } else if (content instanceof Uint8Array) {
      data = [content];
    } else if (content && Symbol.asyncIterator in content) {
      data = content;
    } else if (content) {
      data = iterableFromReadableStream(content);
    } else {
      data = [];
    }

    const entry: FullEntryInfo = {
      compressedSize: file.compressedSize ?? 0,
      comment: encoder.encode(file.comment),
      compressionMethod: file.compressionMethod ?? CompressionMethod.Deflate,
      crc32: file.crc32 ?? 0,
      externalFileAttributes: file.externalFileAttributes ?? 0,
      hasDataDescriptor:
        file.compressedSize === undefined ||
        file.crc32 === undefined ||
        file.uncompressedSize === undefined,
      lastModified: file.lastModified
        ? new DosDate(file.lastModified)
        : new DosDate(),
      localHeaderOffset: this.startingOffset + this.buffer.writtenBytes,
      path: encoder.encode(file.path),
      platformMadeBy: file.platformMadeBy ?? ZipPlatform.DOS,
      uncompressedSize: file.uncompressedSize ?? 0,
      versionMadeBy: file.versionMadeBy ?? ZipVersion.Deflate,
      zip64:
        !!file.zip64 ||
        (file.compressedSize !== undefined &&
          file.compressedSize > 0xffff_ffff) ||
        (file.uncompressedSize !== undefined &&
          file.uncompressedSize > 0xffff_ffff),
    };

    if (entry.zip64) {
      entry.versionMadeBy = ZipVersion.Zip64;
    }

    await this.writeLocalHeader(entry);
    await this.writeFileData(entry, data);

    if (entry.hasDataDescriptor) {
      if (entry.zip64) {
        await this.writeDataDescriptor64(entry);
      } else {
        await this.writeDataDescriptor32(entry);
      }
    }

    this.directory.push(entry);
  }

  private async writeCentralDirectoryInternal(
    fileComment?: string,
  ): Promise<void> {
    const offset = this.startingOffset + this.buffer.writtenBytes;
    let zip64 = false;

    for (const entry of this.directory) {
      await this.writeDirectoryHeader(entry);
      zip64 ||= entry.zip64;
    }

    const size = this.startingOffset + this.buffer.writtenBytes - offset;
    zip64 ||= this.buffer.writtenBytes >= 0xffff_ffff;

    if (zip64) {
      await this.writeZip64EndOfCentralDirectory(offset, size);
      await this.writeZip64EndOfCentralDirectoryLocator(offset);
    }

    await this.writeEndOfCentralDirectory(offset, size, zip64, fileComment);
    await this.buffer.endAndWait();
  }

  private async writeLocalHeader(entry: FullEntryInfo): Promise<void> {
    const compressedSize = maskValue(entry, entry.compressedSize);
    const crc32 = maskValue(entry, entry.crc32);
    const uncompressedSize = maskValue(entry, entry.uncompressedSize);

    const extraField = entry.zip64
      ? this.makeZip64ExtraField({
          compressedSize: entry.hasDataDescriptor ? 0 : entry.compressedSize,
          uncompressedSize: entry.hasDataDescriptor
            ? 0
            : entry.uncompressedSize,
        })
      : new Uint8Array(0);

    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = entry.hasDataDescriptor;
    flags.hasUtf8Strings = true;

    // Local File Header (4.3.7)
    //
    // | offset | field                     | size |
    // | ------ | ------------------------- | ---- |
    // | 0      | signature (0x04034b50)    | 4    |
    // | 4      | version needed to extract | 2    |
    // | 6      | general purpose bit flag  | 2    |
    // | 8      | compression method        | 2    |
    // | 10     | last mod file time        | 2    |
    // | 12     | last mod file date        | 2    |
    // | 14     | crc-32                    | 4    |
    // | 18     | compressed size           | 4    |
    // | 22     | uncompressed size         | 4    |
    // | 26     | file name length          | 2    |
    // | 28     | extra field length        | 2    |
    // | 30     | file name                 | ...  |
    // | ...    | extra field               | ...  |

    const buffer = BufferView.alloc(
      30 + entry.path.byteLength + extraField.byteLength,
    );

    buffer.writeUint32LE(LocalHeaderSignature, 0);
    buffer.writeUint16LE(entry.versionMadeBy, 4);
    buffer.writeUint16LE(flags.value, 6);
    buffer.writeUint16LE(entry.compressionMethod, 8);
    buffer.writeUint32LE(entry.lastModified.getDosDateTime(), 10);
    buffer.writeUint32LE(crc32, 14);
    buffer.writeUint32LE(compressedSize, 18);
    buffer.writeUint32LE(uncompressedSize, 22);
    buffer.writeUint16LE(entry.path.byteLength, 26);
    buffer.writeUint16LE(extraField.byteLength, 28);
    buffer.setBytes(30, entry.path);

    if (extraField) {
      buffer.setBytes(30 + entry.path.byteLength, extraField);
    }

    await this.buffer.write(buffer.getOriginalBytes());
  }

  private async writeDirectoryHeader(entry: FullEntryInfo): Promise<void> {
    if (entry.localHeaderOffset > 0xffff_ffff) {
      entry.zip64 = true;
    }

    const extraField = entry.zip64
      ? this.makeZip64ExtraField({
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          localHeaderOffset: entry.localHeaderOffset,
        })
      : new Uint8Array();

    const flags = new GeneralPurposeFlags();
    flags.hasDataDescriptor = entry.hasDataDescriptor;
    flags.hasUtf8Strings = true;

    const zip64 = entry.zip64;
    const compressedSize = maskValue({ zip64 }, entry.compressedSize);
    const uncompressedSize = maskValue({ zip64 }, entry.uncompressedSize);

    const localHeaderOffsetValue = maskValue(
      { zip64 },
      entry.localHeaderOffset,
    );

    // Central Directory Header (4.3.12)
    //
    // | offset | field                           | size |
    // | ------ | ------------------------------- | ---- |
    // | 0      | signature (0x02014b50)          | 4    |
    // | 4      | version made by                 | 2    |
    // | 6      | version needed to extract       | 2    |
    // | 8      | general purpose bit flag        | 2    |
    // | 10     | compression method              | 2    |
    // | 12     | last mod file time              | 2    |
    // | 14     | last mod file date              | 2    |
    // | 16     | crc-32                          | 4    |
    // | 20     | compressed size                 | 4    |
    // | 24     | uncompressed size               | 4    |
    // | 28     | file name length                | 2    |
    // | 30     | extra field length              | 2    |
    // | 32     | file comment length             | 2    |
    // | 34     | disk number start               | 2    |
    // | 36     | internal file attributes        | 2    |
    // | 38     | external file attributes        | 4    |
    // | 42     | relative offset of local header | 4    |
    // | 46     | file name (variable size)       |      |
    // |        | extra field (variable size)     |      |
    // |        | file comment (variable size)    |      |

    const buffer = BufferView.alloc(
      46 +
        entry.path.byteLength +
        extraField.byteLength +
        entry.comment.byteLength,
    );

    buffer.writeUint32LE(CentralHeaderSignature, 0);
    buffer.writeUint8(entry.versionMadeBy, 4);
    buffer.writeUint8(entry.platformMadeBy, 5);
    buffer.writeUint16LE(entry.versionMadeBy, 6);
    buffer.writeUint16LE(flags.value, 8);
    buffer.writeUint16LE(entry.compressionMethod, 10);
    buffer.writeUint32LE(entry.lastModified.getDosDateTime(), 12);
    buffer.writeUint32LE(entry.crc32, 16);
    buffer.writeUint32LE(compressedSize, 20);
    buffer.writeUint32LE(uncompressedSize, 24);
    buffer.writeUint16LE(entry.path.byteLength, 28);
    buffer.writeUint16LE(extraField?.byteLength ?? 0, 30);
    buffer.writeUint16LE(entry.comment.byteLength, 32);
    buffer.writeUint16LE(0, 34); // disk number start
    buffer.writeUint16LE(0, 36); // internal file attributes
    buffer.writeUint32LE(entry.externalFileAttributes, 38);
    buffer.writeUint32LE(localHeaderOffsetValue, 42);
    buffer.setBytes(46, entry.path);
    buffer.setBytes(46 + entry.path.byteLength, extraField);

    buffer.setBytes(
      46 + entry.path.byteLength + extraField.byteLength,
      entry.comment,
    );

    await this.buffer.write(buffer.getOriginalBytes());
  }

  private async writeFileData(
    entry: FullEntryInfo,
    data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<void> {
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

    Object.assign(entry, descriptor);
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

  private makeZip64ExtraField(entry: EntrySizes): Uint8Array {
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
    // | 4      | central directory start disk | 4    |
    // | 8      | central directory offset     | 8    |
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
    buffer.writeUint16LE(0, 4);
    buffer.writeUint16LE(0, 6);
    buffer.writeUint16LE(zip64 ? 0 : this.directory.length, 8);
    buffer.writeUint16LE(zip64 ? 0 : this.directory.length, 10);
    buffer.writeUint32LE(zip64 ? 0 : size, 12);
    buffer.writeUint32LE(zip64 ? 0 : offset, 16);
    buffer.writeUint16LE(commentBytes.byteLength, 20);
    buffer.setBytes(22, commentBytes);

    await this.buffer.write(buffer.getOriginalBytes());
  }
}

function maskValue(
  options: { hasDataDescriptor?: boolean; zip64?: boolean },
  value: number,
): number {
  if (options.zip64) {
    return 0xffff_ffff;
  }
  if (options.hasDataDescriptor) {
    return 0;
  }
  return value;
}
