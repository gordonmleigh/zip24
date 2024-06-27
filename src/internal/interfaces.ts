import type { ByteStream } from "../util/streams.js";
import type { DecodedCentralHeader } from "./records.js";

/**
 * Represents an object which can read a zip file.
 */
export type ZipReaderLike = {
  readonly entryCount: number;
  readonly comment: string;

  readonly files: () => AsyncIterable<ZipEntryLike>;
} & AsyncIterable<ZipEntryLike>;

/**
 * Represents an object which can read a zip file entry.
 */
export type ZipEntryLike = DecodedCentralHeader & {
  readonly isDirectory: boolean;
  readonly isFile: boolean;

  readonly uncompressedData: ByteStream;

  readonly toBuffer: () => PromiseLike<Uint8Array>;
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  readonly toReadableStream: () => ReadableStream;
  readonly toText: (encoding?: string) => PromiseLike<string>;
} & AsyncIterable<Uint8Array>;
