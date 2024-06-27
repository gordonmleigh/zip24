import { CompressionMethod } from "../internal/compression-core.js";
import { ZipPlatform, ZipVersion } from "../internal/constants.js";
import {
  DosFileAttributes,
  type FileAttributes,
} from "../internal/file-attributes.js";
import { GeneralPurposeFlags } from "../internal/flags.js";
import type { ZipEntryLike } from "../internal/interfaces.js";
import {
  bufferFromIterable,
  readableStreamFromIterable,
  textFromIterable,
  type ByteStream,
} from "../util/streams.js";

export class ZipEntryReader implements ZipEntryLike {
  private uncompressedDataInternal?: ByteStream;

  public platformMadeBy = ZipPlatform.DOS;
  public versionMadeBy = ZipVersion.Zip64;
  public versionNeeded = ZipVersion.Zip64;
  public readonly flags = new GeneralPurposeFlags();
  public compressionMethod = CompressionMethod.Deflate;
  public lastModified = new Date();
  public crc32 = 0;
  public compressedSize = 0;
  public uncompressedSize = 0;
  public pathLength = 0;
  public extraFieldLength = 0;
  public commentLength = 0;
  public internalAttributes = 0;
  public attributes: FileAttributes = new DosFileAttributes();
  public localHeaderOffset = 0;
  public path = "";
  public comment = "";

  public get isDirectory(): boolean {
    return this.path.endsWith("/") || !!this.attributes.isDirectory;
  }

  public get isFile(): boolean {
    // is indeterminate if we can't understand the attributes
    return !this.path.endsWith("/") && !!this.attributes.isFile;
  }

  public get uncompressedData(): ByteStream {
    if (!this.uncompressedDataInternal) {
      throw new Error(`data has not been initialized`);
    }
    return this.uncompressedDataInternal;
  }
  public set uncompressedData(value: ByteStream) {
    this.uncompressedDataInternal = value;
  }

  public async toBuffer(): Promise<Uint8Array> {
    return await bufferFromIterable(this.uncompressedData);
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  public toReadableStream(): ReadableStream {
    return readableStreamFromIterable(this.uncompressedData);
  }

  public async toText(encoding?: string): Promise<string> {
    return await textFromIterable(this.uncompressedData, encoding);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.uncompressedData;
  }
}
