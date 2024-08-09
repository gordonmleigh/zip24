import { WriteStream, createWriteStream } from "node:fs";
import type { CreateWriteStreamOptions } from "node:fs/promises";
import type { Writable } from "node:stream";
import { addAbortListener } from "../util/abort.js";
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
  public static fromWritable(stream: Writable): ZipWriter {
    const abort = new AbortController();

    stream.once("error", (cause) => {
      abort.abort(cause);
    });

    return new this({
      sink: {
        close: async () => {
          await awaitCallback((callback) => {
            stream.end(callback);
          }, abort.signal);
        },

        write: async (chunk) => {
          await awaitCallback((callback) => {
            stream.write(chunk, callback);
          }, abort.signal);
        },
      },
    });
  }

  public static fromWriteStream(stream: WriteStream): ZipWriter {
    const abort = new AbortController();

    stream.once("error", (cause) => {
      abort.abort(cause);
    });

    return new this({
      sink: {
        close: async () => {
          await awaitCallback((callback) => {
            stream.close(callback);
          }, abort.signal);
        },

        write: async (chunk) => {
          await awaitCallback((callback) => {
            stream.write(chunk, callback);
          }, abort.signal);
        },
      },
    });
  }

  public static open(
    path: string,
    options?: Omit<CreateWriteStreamOptions, "encoding">,
  ): ZipWriter {
    return this.fromWriteStream(
      createWriteStream(path, { ...options, encoding: undefined }),
    );
  }

  public constructor(options?: ZipWriterOptions) {
    super({
      compressors: defaultCompressors,
      ...options,
    });
  }
}

async function awaitCallback(
  action: (callback: (error: unknown) => void) => void,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = addAbortListener(signal, reject);

    action((error) => {
      cleanup();

      if (error) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
