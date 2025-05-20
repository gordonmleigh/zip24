import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import {
  ZipWriter as ZipWriterBase,
  type ZipWriterOptions,
} from "../writer.ts";

export type { ZipWriterOptions } from "../writer.ts";

/**
 * An object which can read a zip file from a {@link RandomAccessReader}.
 */
export class ZipWriter extends ZipWriterBase {
  /**
   * Read a zip file from the given path.
   */
  public static open(
    path: string,
    options?: Omit<ZipWriterOptions, "destination">,
  ): ZipWriter {
    return new ZipWriter({
      ...options,
      destination: Writable.toWeb(createWriteStream(path)),
    });
  }
}
