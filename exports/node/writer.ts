import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import { ZipWriter as ZipWriterBase } from "../writer.ts";

/**
 * Options for {@link ZipWriter}.
 */
export type ZipWriterOptions = {
  bufferSize?: number | undefined;
  comment?: string | undefined;
  destination?: Writable | WritableStream<Uint8Array> | undefined;
  preventAbort?: boolean | undefined;
  preventClose?: boolean | undefined;
  startingOffset?: number | undefined;
};

/**
 * An object which can create a zip file..
 */
export class ZipWriter extends ZipWriterBase {
  /**
   * Create a zip file at the given path.
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

  public constructor(options?: ZipWriterOptions) {
    super({
      ...options,
      destination:
        options?.destination instanceof Writable
          ? Writable.toWeb(options.destination)
          : options?.destination,
    });
  }
}
