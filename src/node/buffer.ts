import {
  ZipBufferReader as ZipBufferReaderBase,
  type ZipBufferReaderOptions,
} from "../base/buffer.js";
import type { BufferLike } from "../internal/binary.js";
import { defaultDecompressors } from "./compression.js";

/**
 * An object which can read a zip file from a buffer.
 */
export class ZipBufferReader extends ZipBufferReaderBase {
  public constructor(buffer: BufferLike, options?: ZipBufferReaderOptions) {
    super(buffer, {
      decompressors: defaultDecompressors,
      ...options,
    });
  }
}
