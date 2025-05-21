import { assert } from "../../util/assert.ts";
import { BufferView, type BufferLike } from "../../util/binary.ts";
import { DosDate } from "../../util/dos-date.ts";
import { EncodedString } from "../../util/encoded-string.ts";
import { makeBuffer, type Serializable } from "../../util/serialization.ts";
import {
  normalizeByteSource,
  normalizeByteSourceProvider,
  type ByteSource,
  type ByteSourceProvider,
} from "../../util/streams.ts";
import {
  MultiDiskError,
  ZipFormatError,
  ZipSignatureError,
} from "../errors.ts";
import { ExtraFieldTag, ZipPlatform } from "./constants.ts";
import {
  ExtraFieldCollection,
  Zip64ExtraField,
} from "./extra-field-collection.ts";
import {
  getAttributesPlatform,
  makePlatformAttributes,
  type FileAttributes,
} from "./file-attributes.ts";
import { GeneralPurposeFlags } from "./flags.ts";
import type { ZipTrailerFields } from "./zip-trailer.ts";

export type CentralDirectoryHeaderInit = {
  attributes: FileAttributes;
  comment: Uint8Array | string;
  compressedSize: number;
  compressionMethod: number;
  crc32: number;
  extraField: ExtraFieldCollection;
  flags: GeneralPurposeFlags;
  lastModified: Date;
  localHeaderOffset: number;
  path: Uint8Array | string;
  uncompressedSize: number;
  versionMadeBy: number;
  versionNeeded: number;
  zip64?: boolean | undefined;
};

export class CentralDirectoryHeader
  implements Serializable, CentralDirectoryHeaderInit
{
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

  public static readonly FixedSize = 46;
  // fixed size + max file name + max extra + max comment
  public static readonly MaxSize = this.FixedSize + 3 * 0xffff;
  public static readonly Signature = 0x02014b50;

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): CentralDirectoryHeader {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("central directory header", signature);
    }

    const versionMadeBy = view.readUint8(4);
    const platformMadeBy = view.readUint8(5);
    const versionNeeded = view.readUint16LE(6);

    const flags = new GeneralPurposeFlags(view.readUint16LE(8));
    const compressionMethod = view.readUint16LE(10);
    const lastModified = DosDate.fromDosUint32(view.readUint32LE(12));
    const crc32 = view.readUint32LE(16);
    const compressedSize = view.readUint32LE(20);
    const uncompressedSize = view.readUint32LE(24);

    const pathLength = view.readUint16LE(28);
    const extraFieldLength = view.readUint16LE(30);
    const commentLength = view.readUint16LE(32);

    const diskNumberStart = view.readUint16LE(34);

    // 0xffff means that the actual value is stored in the zip64 eocdr
    if (diskNumberStart !== 0 && diskNumberStart !== 0xffff) {
      throw new MultiDiskError();
    }

    const attributes = makePlatformAttributes(
      platformMadeBy as ZipPlatform,
      view.readUint32LE(38),
    );

    const localHeaderOffset = view.readUint32LE(42);
    const path = view.getOriginalBytes(46, pathLength);

    const extraField = ExtraFieldCollection.deserialize(
      view,
      46 + pathLength,
      extraFieldLength,
    );

    const comment = view.getOriginalBytes(
      46 + pathLength + extraFieldLength,
      commentLength,
    );

    return new this({
      attributes,
      comment,
      compressedSize,
      compressionMethod,
      crc32,
      extraField,
      flags,
      lastModified,
      localHeaderOffset,
      path,
      uncompressedSize,
      versionMadeBy,
      versionNeeded,
    });
  }

  public static readTotalSize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return (
      this.FixedSize + this.readVariableSize(buffer, byteOffset, byteLength)
    );
  }

  public static readVariableSize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): number {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const signature = view.readUint32LE(0);

    if (signature !== this.Signature) {
      throw new ZipSignatureError("central directory header", signature);
    }

    const pathLength = view.readUint16LE(28);
    const extraFieldLength = view.readUint16LE(30);
    const commentLength = view.readUint16LE(32);

    return pathLength + extraFieldLength + commentLength;
  }

  public attributes: FileAttributes;
  public comment: string;
  public compressedSize: number;
  public compressionMethod: number;
  public crc32: number;
  public extraField: ExtraFieldCollection;
  public flags: GeneralPurposeFlags;
  public lastModified: Date;
  public localHeaderOffset: number;
  public path: string;
  public rawComment: EncodedString;
  public rawPath: EncodedString;
  public uncompressedSize: number;
  public versionMadeBy: number;
  public versionNeeded: number;
  public zip64: boolean;

  public get totalSize(): number {
    return (
      CentralDirectoryHeader.FixedSize +
      this.rawPath.byteLength +
      this.extraField.byteLength +
      this.rawComment.byteLength
    );
  }

  public get platformMadeBy(): ZipPlatform {
    return getAttributesPlatform(this.attributes);
  }

  public constructor(init: CentralDirectoryHeaderInit) {
    this.attributes = init.attributes;
    this.compressedSize = init.compressedSize;
    this.compressionMethod = init.compressionMethod;
    this.crc32 = init.crc32;
    this.extraField = init.extraField;
    this.flags = init.flags;
    this.lastModified = init.lastModified;
    this.localHeaderOffset = init.localHeaderOffset;
    this.uncompressedSize = init.uncompressedSize;
    this.versionMadeBy = init.versionMadeBy;
    this.versionNeeded = init.versionNeeded;

    const encoding = this.flags.hasUtf8Strings ? "utf8" : "cp437";
    this.rawComment = new EncodedString(encoding, init.comment);
    this.rawPath = new EncodedString(encoding, init.path);

    this.comment = this.extraField.fallbackUnicode(
      this.rawComment,
      ExtraFieldTag.UnicodeCommentField,
    );

    this.path = this.extraField.fallbackUnicode(
      this.rawPath,
      ExtraFieldTag.UnicodePathField,
    );

    const zip64Field = this.extraField.getField(
      ExtraFieldTag.Zip64ExtendedInfo,
    );
    this.zip64 = !!init.zip64 || !!zip64Field;
    zip64Field?.readFields(this);
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const extraField = new ExtraFieldCollection(
      this.extraField.fields.filter(
        (x) => (x.tag as ExtraFieldTag) !== ExtraFieldTag.Zip64ExtendedInfo,
      ),
    );

    if (this.zip64) {
      extraField.fields.push(Zip64ExtraField.from(this));
    }

    const view = makeBuffer(
      CentralDirectoryHeader.FixedSize +
        this.rawPath.byteLength +
        extraField.byteLength +
        this.rawComment.byteLength,
      buffer,
      byteOffset,
      byteLength,
    );

    view.writeUint32LE(CentralDirectoryHeader.Signature, 0);
    view.writeUint8(this.versionMadeBy, 4);
    view.writeUint8(this.platformMadeBy, 5);
    view.writeUint16LE(this.versionNeeded, 6);
    view.writeUint16LE(this.flags.value, 8);
    view.writeUint16LE(this.compressionMethod, 10);
    view.writeUint32LE(new DosDate(this.lastModified).getDosDateTime(), 12);
    view.writeUint32LE(this.crc32, 16);
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.compressedSize, 20);
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.uncompressedSize, 24);
    view.writeUint16LE(this.rawPath.byteLength, 28);
    view.writeUint16LE(extraField.byteLength, 30);
    view.writeUint16LE(this.rawComment.byteLength, 32);
    view.writeUint16LE(0, 34); // disk number start
    view.writeUint16LE(0, 36); // internal file attributes
    view.writeUint32LE(this.attributes.rawValue, 38);
    view.writeUint32LE(this.zip64 ? 0xffff_ffff : this.localHeaderOffset, 42);

    let offset = 46;

    view.setBytes(offset, this.rawPath);
    offset += this.rawPath.byteLength;

    extraField.serialize(view, offset);
    offset += extraField.byteLength;

    view.setBytes(offset, this.rawComment);
    return view.getOriginalBytes();
  }
}

export type Zip64VersionFields = {
  platformMadeBy: number;
  versionMadeBy: number;
  versionNeeded: number;
};

export type CentralDirectoryReader = ZipTrailerFields &
  AsyncIterable<CentralDirectoryHeader, void, void>;

export class CentralDirectoryBufferReader
  implements
    Iterable<CentralDirectoryHeader, void, void>,
    CentralDirectoryReader
{
  readonly #buffer: BufferView;
  readonly #trailer: ZipTrailerFields;

  public get size(): number {
    return this.#trailer.size;
  }
  public get comment(): string {
    return this.#trailer.comment;
  }
  public get count(): number {
    return this.#trailer.count;
  }
  public get offset(): number {
    return this.#trailer.offset;
  }
  public get zip64(): Zip64VersionFields | undefined {
    return this.#trailer.zip64;
  }

  public constructor(
    trailer: ZipTrailerFields,
    buffer: BufferLike,
    bufferOffset?: number,
  ) {
    this.#buffer = new BufferView(buffer, bufferOffset, trailer.size);
    this.#trailer = trailer;
  }

  public [Symbol.iterator](): Iterator<CentralDirectoryHeader, void, void> {
    return this.entries();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async *[Symbol.asyncIterator](): AsyncIterator<
    CentralDirectoryHeader,
    void,
    void
  > {
    yield* this.entries();
  }

  public *entries(): IterableIterator<CentralDirectoryHeader, void, void> {
    let offset = 0;

    for (let index = 0; index < this.#trailer.count; ++index) {
      const header = CentralDirectoryHeader.deserialize(this.#buffer, offset);
      offset += header.totalSize;
      yield header;
    }
  }
}

export class CentralDirectoryStreamReader implements CentralDirectoryReader {
  readonly #source: () => ReadableStream<Uint8Array>;
  readonly #trailer: ZipTrailerFields;

  public get size(): number {
    return this.#trailer.size;
  }
  public get comment(): string {
    return this.#trailer.comment;
  }
  public get count(): number {
    return this.#trailer.count;
  }
  public get offset(): number {
    return this.#trailer.offset;
  }
  public get zip64(): Zip64VersionFields | undefined {
    return this.#trailer.zip64;
  }

  public constructor(trailer: ZipTrailerFields, source: ByteSourceProvider) {
    this.#source = normalizeByteSourceProvider(source);
    this.#trailer = trailer;
  }

  public [Symbol.asyncIterator](): AsyncIterableIterator<
    CentralDirectoryHeader,
    void,
    void
  > {
    const reader = new CentralDirectoryStream(this.#source(), {
      entryCount: this.#trailer.count,
    });

    return reader[Symbol.asyncIterator]();
  }
}

export type CentralDirectoryStreamOptions = {
  entryCount: number;
};

export class CentralDirectoryStream extends ReadableStream<CentralDirectoryHeader> {
  readonly #source: ReadableStreamDefaultReader<Uint8Array>;
  readonly #entryCount: number;

  #controller!: ReadableStreamDefaultController<CentralDirectoryHeader>;
  #headersRead = 0;
  #buffer = new Uint8Array(256);
  #bufferSize = 0;
  #bufferTarget = 0;

  public constructor(
    source: ByteSource,
    options: CentralDirectoryStreamOptions,
  ) {
    super({
      start: async (controller) => {
        if (options.entryCount === 0) {
          controller.close();
          return;
        }
        // finish constructing first
        await Promise.resolve();
        this.#controller = controller;
      },

      pull: async (controller) => {
        try {
          await this.#pull();
        } catch (error) {
          controller.error(error);
          await this.#source.cancel();
        }
      },
    });
    this.#entryCount = options.entryCount;
    this.#source = normalizeByteSource(source).getReader();
  }

  #bufferChunk(chunk: Uint8Array): void {
    if (this.#bufferTarget > this.#buffer.byteLength) {
      const oldBuffer = this.#buffer;
      this.#buffer = new Uint8Array(this.#bufferTarget);
      this.#buffer.set(oldBuffer.subarray(0, this.#bufferSize));
      this.#buffer.set(chunk, this.#bufferSize);
    }

    this.#buffer.set(chunk, this.#bufferSize);
    this.#bufferSize = this.#bufferSize + chunk.byteLength;
  }

  #emit(header: CentralDirectoryHeader): void {
    ++this.#headersRead;
    this.#controller.enqueue(header);
  }

  #processChunk(newChunk: Uint8Array): number {
    const currentCount = this.#headersRead;

    let offset = 0;
    do {
      offset = this.#processEntry(newChunk, offset);
    } while (offset);

    // return number read from this chunk
    return this.#headersRead - currentCount;
  }

  #processEntry(newChunk: Uint8Array, byteOffset: number): number {
    if (this.#bufferTarget > 0) {
      // we have something in the buffer and we already parsed the header length
      // into #bufferTarget

      // we should only have an offset if we're processing the chunk, not buffer
      assert(byteOffset === 0);

      if (this.#bufferTarget - this.#bufferSize > newChunk.byteLength) {
        // we still don't have enough, so add the chunk on to the existing buffer
        this.#bufferChunk(newChunk);
        return 0;
      }
      // we now have enough data to process an entry
      const nextOffset = this.#bufferTarget - this.#bufferSize;
      // buffer what we need from the new chunk
      this.#bufferChunk(newChunk.subarray(0, nextOffset));
      // parse and reset the buffer
      this.#emit(this.#unbufferEntry());
      // return the offset in newChunk of the next header
      return nextOffset;
    } else if (this.#bufferSize > 0) {
      // we have something in the buffer but didn't already read the length

      // we should only have an offset if we're processing the chunk, not buffer
      assert(byteOffset === 0);

      const requiredBytes = CentralDirectoryHeader.FixedSize - this.#bufferSize;
      assert(requiredBytes > 0);

      if (requiredBytes > newChunk.byteLength) {
        // we still don't have enough for the fixed fields, so buffer and return
        this.#bufferChunk(newChunk);
        return 0;
      }

      // we now have enough for the fixed fields so read the total length
      this.#bufferChunk(newChunk.subarray(0, requiredBytes));
      const newChunkRemaining = newChunk.byteLength - requiredBytes;

      const variableLength = CentralDirectoryHeader.readVariableSize(
        this.#buffer,
        0,
        this.#bufferSize,
      );
      const headerLength = CentralDirectoryHeader.FixedSize + variableLength;

      if (variableLength > newChunkRemaining) {
        // we don't have enough for the whole header, but we know how much we
        // need now
        this.#bufferTarget = headerLength;
        // buffer the rest of the chunk, skipping the bit we already buffered
        this.#bufferChunk(newChunk.subarray(requiredBytes));
        return 0;
      }

      const nextOffset = requiredBytes + variableLength;

      // we now have enough data to process an entry - buffer the remaining header
      this.#bufferChunk(newChunk.subarray(requiredBytes, nextOffset));
      // parse and reset the buffer
      this.#emit(this.#unbufferEntry());
      // return the offset in new chunk of the next header
      return nextOffset;
    }

    const availableBytes = newChunk.byteLength - byteOffset;
    if (availableBytes < CentralDirectoryHeader.FixedSize) {
      // there's nothing in the buffer and the new chunk is too short
      this.#bufferChunk(newChunk.subarray(byteOffset));
      return 0;
    }

    // there's nothing in the buffer and the new chunk is at least long enough
    // to read the total length

    const headerLength = CentralDirectoryHeader.readTotalSize(
      newChunk,
      byteOffset,
    );
    if (availableBytes >= headerLength) {
      // we have enough data to read the whole header
      this.#emit(CentralDirectoryHeader.deserialize(newChunk, byteOffset));
      // return the offset in newChunk of the next header
      return byteOffset + headerLength;
    }

    // we don't have enough data for the variable fields
    this.#bufferTarget = headerLength;
    this.#bufferChunk(newChunk.subarray(byteOffset));
    return 0;
  }

  async #pull(): Promise<void> {
    // loop until we read at least one entry
    let chunk: Uint8Array;
    do {
      const next = await this.#source.read();
      if (next.done) {
        throw new ZipFormatError("unexpected end of data");
      }
      chunk = next.value;
    } while (this.#processChunk(chunk) === 0);

    if (this.#headersRead >= this.#entryCount) {
      this.#controller.close();
      await this.#source.cancel();
    }
  }

  #unbufferEntry(): CentralDirectoryHeader {
    const header = CentralDirectoryHeader.deserialize(
      this.#buffer,
      0,
      this.#bufferSize,
    );

    this.#bufferSize = 0;
    this.#bufferTarget = 0;
    return header;
  }
}
