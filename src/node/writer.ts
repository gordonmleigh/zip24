import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import {
  ZipWriter as ZipWriterBase,
  type ZipWriterOptions,
} from "../base/writer.js";
import { defaultCompressors } from "./compression.js";

/**
 * An object which can output a zip file.
 */
export class ZipWriter extends ZipWriterBase {
  public static open(path: string, options?: ZipWriterOptions): ZipWriter {
    const file = createWriteStream(path);
    const zip = new ZipWriter(options);
    zip.asReadable().pipe(file);
    return zip;
  }

  public constructor(options?: ZipWriterOptions) {
    super({
      compressors: defaultCompressors,
      ...options,
    });
  }

  public asReadable(): Readable {
    return Readable.from(this);
  }
}
