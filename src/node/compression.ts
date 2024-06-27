import { Readable } from "node:stream";
import { createDeflateRaw, createInflateRaw } from "node:zlib";
import {
  CompressionMethod,
  type CompressionAlgorithms,
} from "../core/compression-core.js";

/**
 * Default Node.js (zlib) compression methods.
 */
export const defaultCompressors = {
  [CompressionMethod.Deflate]: (input) => {
    return Readable.from(input).pipe(createDeflateRaw());
  },
} satisfies CompressionAlgorithms;

/**
 * Default Node.js (zlib) decompression methods.
 */
export const defaultDecompressors = {
  [CompressionMethod.Deflate]: (input) => {
    return Readable.from(input).pipe(createInflateRaw());
  },
} satisfies CompressionAlgorithms;
