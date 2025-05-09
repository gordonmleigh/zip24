import { assert } from "../util/assert.ts";
import { computeCrc32 } from "../util/crc32.ts";
import {
  identityStream,
  mapIterable,
  normalizeDataSource,
  type AsyncTransform,
  type ByteSource,
  type DataSource,
} from "../util/streams.ts";
import type { DirtyPartial } from "../util/type-utils.ts";
import { ZipFormatError } from "./errors.ts";

export const CompressionMethod = {
  Stored: 0,
  Deflate: 8,
} as const;

export type CompressionMethod =
  (typeof CompressionMethod)[keyof typeof CompressionMethod];

export type DataDescriptor = {
  compressedSize: number;
  crc32: number;
  uncompressedSize: number;
};

/**
 * A map of compression methods to compression/decompression algorithms.
 */
export type CompressionAlgorithms = Record<number, AsyncTransform | undefined>;

export async function* compress(
  compressionMethod: number,
  check: DirtyPartial<DataDescriptor> = {},
  output: DataDescriptor,
  content: DataSource | undefined,
  compressors: CompressionAlgorithms,
): AsyncGenerator<Uint8Array> {
  const data = normalizeDataSource(content);

  let compressor = compressors[compressionMethod];
  if (!compressor && compressionMethod === CompressionMethod.Stored) {
    compressor = identityStream;
  }
  if (!compressor) {
    throw new ZipFormatError(
      `unknown compression method ${compressionMethod.toString(16)}`,
    );
  }

  let inputConsumed = false;

  yield* mapIterable(
    compressor(
      mapIterable(
        data,
        (chunk) => {
          output.crc32 = computeCrc32(chunk, output.crc32);
          output.uncompressedSize += chunk.byteLength;
          return chunk;
        },
        () => {
          inputConsumed = true;
        },
      ),
    ),
    (chunk) => {
      output.compressedSize += chunk.byteLength;
      return chunk;
    },
  );

  assert(
    inputConsumed,
    "the compression algorithm must consume the input before terminating the output",
  );

  if (check.crc32 !== undefined && output.crc32 !== check.crc32) {
    throw new ZipFormatError(`crc32 was supplied but is invalid`);
  }
  if (
    check.compressedSize !== undefined &&
    output.compressedSize !== check.compressedSize
  ) {
    throw new ZipFormatError(`compressedSize was supplied but is invalid`);
  }
  if (
    check.uncompressedSize !== undefined &&
    output.uncompressedSize !== check.uncompressedSize
  ) {
    throw new ZipFormatError(`uncompressedSize was supplied but is invalid`);
  }
}

export async function* decompress(
  compressionMethod: number,
  descriptor: DataDescriptor,
  input: ByteSource,
  decompressors: CompressionAlgorithms,
): AsyncGenerator<Uint8Array> {
  const decompressor = decompressors[compressionMethod];
  let output: ByteSource;

  if (decompressor) {
    output = decompressor(input);
  } else if (compressionMethod === CompressionMethod.Stored) {
    output = input;
  } else {
    throw new ZipFormatError(
      `unknown compression method ${compressionMethod.toString(16)}`,
    );
  }

  let checkCrc32 = 0;
  let bytesRead = 0;

  for await (const chunk of output) {
    checkCrc32 = computeCrc32(chunk, checkCrc32);
    bytesRead += chunk.byteLength;
    yield chunk;
  }

  if (bytesRead !== descriptor.uncompressedSize) {
    throw new ZipFormatError(`zip file is corrupt (file size mismatch)`);
  }
  if (checkCrc32 !== descriptor.crc32) {
    throw new ZipFormatError(`zip file is corrupt (crc32 mismatch)`);
  }
}
