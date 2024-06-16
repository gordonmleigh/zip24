import {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
  type CompressionAlgorithms,
} from "../common.js";
import { computeCrc32 } from "../internal/crc32.js";
import type { ZipEntry } from "../internal/file-entry.js";
import { CentralHeaderLength } from "../internal/signatures.js";
import {
  bufferFromIterable,
  readableStreamFromIterable,
  type ByteStream,
} from "../internal/streams.js";

export class ZipEntryReader implements ZipEntry {
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
  public fileNameLength = 0;
  public extraFieldLength = 0;
  public fileCommentLength = 0;
  public internalFileAttributes = 0;
  public externalFileAttributes?: DosFileAttributes | UnixFileAttributes;
  public localHeaderOffset = 0;
  public fileName = "";
  public fileComment = "";

  public get isDirectory(): boolean {
    return (
      this.fileName.endsWith("/") || !!this.externalFileAttributes?.isDirectory
    );
  }

  public get isSymbolicLink(): boolean {
    return (
      this.externalFileAttributes instanceof UnixFileAttributes &&
      this.externalFileAttributes.isSymbolicLink
    );
  }

  public get totalRecordLength(): number {
    return (
      CentralHeaderLength +
      this.fileNameLength +
      this.extraFieldLength +
      this.fileCommentLength
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

  public async getBuffer(): Promise<Uint8Array> {
    return await bufferFromIterable(this.uncompressedData);
  }

  public async getText(encoding?: string): Promise<string> {
    const decoder = new TextDecoder(encoding);
    let output = "";

    for await (const chunk of this.uncompressedData) {
      output += decoder.decode(chunk, { stream: true });
    }

    output += decoder.decode();
    return output;
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    yield* this.uncompressedData;
  }
}

export async function* decompress(
  entry: ZipEntry,
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
    throw new Error(
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

  if (bytesRead !== entry.uncompressedSize || checkCrc32 !== entry.crc32) {
    throw new Error(`zip file is corrupt`);
  }
}
