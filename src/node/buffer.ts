import type { BufferLike } from "../util/binary.ts";
import {
  ZipBufferReader as ZipBufferReaderBase,
  type ZipBufferReaderOptions,
} from "../web/buffer.ts";
import { defaultDecompressors } from "./compression.ts";

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
