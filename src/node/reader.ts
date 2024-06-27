import { open } from "node:fs/promises";
import type { RandomAccessReader } from "../util/streams.js";
import {
  ZipReader as ZipReaderBase,
  type ZipReaderOptions,
} from "../web/reader.js";
import { defaultDecompressors } from "./compression.js";

/**
 * An object which can read a zip entry from a {@link RandomAccessReader}.
 */
export class ZipReader extends ZipReaderBase {
  public static async open(
    path: string,
    options?: ZipReaderOptions,
  ): Promise<ZipReader> {
    const file = await open(path);
    const { size } = await file.stat();
    return this.fromReader(file, size, options);
  }

  public constructor(
    reader: RandomAccessReader,
    fileSize: number,
    options?: ZipReaderOptions,
  ) {
    super(reader, fileSize, {
      decompressors: defaultDecompressors,
      ...options,
    });
  }
}
