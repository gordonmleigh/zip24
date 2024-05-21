import { Readable } from "node:stream";
import { createDeflateRaw, createInflateRaw } from "node:zlib";
import { CompressionMethod, type CompressionAlgorithms } from "../common.js";

/**
 * Default Node.js (zlib) compression methods.
 */
export const defaultCompressors: CompressionAlgorithms = {
  [CompressionMethod.Deflate]: (input) => {
    return Readable.from(input).pipe(createDeflateRaw());
  },
};

/**
 * Default Node.js (zlib) decompression methods.
 */
export const defaultDecompressors: CompressionAlgorithms = {
  [CompressionMethod.Deflate]: (input) => {
    return Readable.from(input).pipe(createInflateRaw());
  },
};
