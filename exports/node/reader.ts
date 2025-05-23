import { open } from "node:fs/promises";
import {
  ZipReader as ZipReaderBase,
  type ZipReaderOptions,
} from "../reader.ts";

export type {
  OpenStreamOptions,
  RandomAccessReader,
  RandomAccessReadOptions,
  ZipReaderOptions,
  ZipReaderOptionsWithFileSize,
} from "../reader.ts";

/**
 * An object which can read a zip file from a {@link RandomAccessReader}.
 */
export class ZipReader extends ZipReaderBase {
  /**
   * Read a zip file from the given path.
   */
  public static async open(
    path: string,
    options?: ZipReaderOptions,
  ): Promise<ZipReader> {
    const reader = await open(path);
    const stats = await reader.stat();
    return new ZipReader(reader, stats.size, options);
  }
}
