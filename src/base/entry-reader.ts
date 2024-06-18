import {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipFormatError,
  ZipPlatform,
  ZipVersion,
  type CompressionAlgorithms,
  type ZipEntryLike,
} from "../common.js";
import { computeCrc32 } from "../internal/crc32.js";
import type { ZipEntry as ZipEntryInternal } from "../internal/directory-entry.js";
import { CentralHeaderLength } from "../internal/signatures.js";
import {
  bufferFromIterable,
  readableStreamFromIterable,
  textFromIterable,
  type ByteStream,
} from "../internal/streams.js";

export class ZipEntryReader implements ZipEntryInternal, ZipEntryLike {
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
  public attributes?: DosFileAttributes | UnixFileAttributes;
  public localHeaderOffset = 0;
  public path = "";
  public comment = "";

  public get isDirectory(): boolean {
    return this.path.endsWith("/") || !!this.attributes?.isDirectory;
  }

  public get isFile(): boolean {
    // is indeterminate if we can't understand the attributes
    return !this.path.endsWith("/") && !!this.attributes?.isFile;
  }

  public get totalRecordLength(): number {
    return (
      CentralHeaderLength +
      this.pathLength +
      this.extraFieldLength +
      this.commentLength
    );
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

  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  public createReadableStream(): ReadableStream {
    return readableStreamFromIterable(this.uncompressedData);
  }

  public async toBuffer(): Promise<Uint8Array> {
    return await bufferFromIterable(this.uncompressedData);
  }

  public async toText(encoding?: string): Promise<string> {
    return await textFromIterable(this.uncompressedData, encoding);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.uncompressedData;
  }
}

export async function* decompress(
  entry: ZipEntryInternal,
  input: ByteStream,
  decompressors: CompressionAlgorithms,
): AsyncGenerator<Uint8Array> {
  const decompressor = decompressors[entry.compressionMethod];
  let output: ByteStream;

  if (decompressor) {
    output = decompressor(input);
  } else if (entry.compressionMethod === CompressionMethod.Stored) {
    output = input;
  } else {
    throw new ZipFormatError(
      `unknown compression method ${(entry.compressionMethod as number).toString(16)}`,
    );
  }

  let checkCrc32: number | undefined;
  let bytesRead = 0;

  for await (const chunk of output) {
    checkCrc32 = computeCrc32(chunk, checkCrc32);
    bytesRead += chunk.byteLength;
    yield chunk;
  }

  if (bytesRead !== entry.uncompressedSize) {
    throw new ZipFormatError(`zip file is corrupt (file size mismatch)`);
  }
  if (checkCrc32 !== entry.crc32) {
    throw new ZipFormatError(`zip file is corrupt (crc32 mismatch)`);
  }
}
