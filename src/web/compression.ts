import {
  CompressionMethod,
  type CompressionAlgorithms,
} from "../core/compression-core.js";
import {
  iterableFromReadableStream,
  readableStreamFromIterable,
} from "../util/streams.js";

/**
 * Default Web API (CompressionStream) compression methods.
 */
export const defaultCompressors = {
  [CompressionMethod.Deflate]: (
    input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> => {
    return iterableFromReadableStream(
      readableStreamFromIterable(input).pipeThrough(
        // eslint-disable-next-line n/no-unsupported-features/node-builtins
        new CompressionStream("deflate-raw"),
      ),
    );
  },
} satisfies CompressionAlgorithms;

/**
 * Default Web API (DecompressionStream) decompression methods.
 */
export const defaultDecompressors = {
  [CompressionMethod.Deflate]: (
    input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> => {
    return iterableFromReadableStream(
      readableStreamFromIterable(input).pipeThrough(
        // eslint-disable-next-line n/no-unsupported-features/node-builtins
        new DecompressionStream("deflate-raw"),
      ),
    );
  },
} satisfies CompressionAlgorithms;
