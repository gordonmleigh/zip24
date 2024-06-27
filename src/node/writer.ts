import {
  ZipWriter as ZipWriterBase,
  type ZipWriterOptions as ZipWriterBaseOptions,
} from "../web/writer.js";
import { defaultCompressors } from "./compression.js";

export type ZipWriterOptions = ZipWriterBaseOptions;

/**
 * An object which can output a zip file.
 */
export class ZipWriter extends ZipWriterBase {
  public constructor(options?: ZipWriterOptions) {
    super({
      compressors: defaultCompressors,
      ...options,
    });
  }
}
