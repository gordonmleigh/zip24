import { assert } from "../util/assert.ts";
import type { DataSource } from "../util/streams.ts";
import { ZipEntry, type ZipEntryInfo } from "./entry.ts";
import { CentralDirectoryHeader } from "./raw/central-directory-header.ts";
import { ZipPlatform, ZipVersion } from "./raw/constants.ts";
import { DataDescriptor } from "./raw/data-descriptor.ts";
import { LocalFileHeader } from "./raw/local-file-header.ts";
import { Eocdr, Zip64Eocdl, Zip64Eocdr } from "./raw/zip-trailer.ts";

/**
 * Options for {@link ZipWriter}.
 */
export type ZipWriterOptions = {
  bufferSize?: number | undefined;
  comment?: string | undefined;
  destination?: WritableStream<Uint8Array> | undefined;
  preventAbort?: boolean | undefined;
  preventClose?: boolean | undefined;
  startingOffset?: number | undefined;
};

/**
 * A class which can create a zip file.
 */
export class ZipWriter
  implements TransformStream<ZipEntryInfo, Uint8Array>, AsyncDisposable
{
  /**
   * Wrap a {@link WritableStream}. Files written to the returned instance will
   * be written directly to the wrapped stream.
   */
  public static wrap(
    destination: WritableStream<Uint8Array>,
    options?: Omit<ZipWriterOptions, "destination">,
  ): ZipWriter {
    return new this({
      ...options,
      destination,
    });
  }

  readonly #centralDirectory: CentralDirectoryHeader[] = [];
  readonly #comment: string;
  readonly #output: ReadableStream<Uint8Array> | undefined;
  readonly #input: WritableStream<ZipEntryInfo>;
  readonly #byteWriter: WritableStreamDefaultWriter<Uint8Array>;
  #currentOffset: number;
  #inputMutex = Promise.resolve();

  public get readable(): ReadableStream<Uint8Array> {
    assert(
      this.#output,
      `the stream is not readable when a destination has been supplied`,
    );
    return this.#output;
  }

  public get writable(): WritableStream<ZipEntryInfo> {
    return this.#input;
  }

  public constructor(options: ZipWriterOptions = {}) {
    this.#comment = options.comment ?? "";
    this.#currentOffset = options.startingOffset ?? 0;

    if (options.destination) {
      this.#byteWriter = options.destination.getWriter();
    } else {
      const buffer = new TransformStream<Uint8Array, Uint8Array>(
        undefined,
        options.bufferSize
          ? new ByteLengthQueuingStrategy({
              highWaterMark: options.bufferSize,
            })
          : undefined,
      );
      this.#output = buffer.readable;
      this.#byteWriter = buffer.writable.getWriter();
    }

    this.#input = new WritableStream({
      abort: async (reason) => {
        if (options.destination && options.preventAbort) {
          this.#byteWriter.releaseLock();
        } else {
          await this.#byteWriter.abort(reason);
        }
      },

      close: async () => {
        await this.#writeCentralDirectory();

        if (options.destination && options.preventClose) {
          this.#byteWriter.releaseLock();
        } else {
          await this.#byteWriter.close();
        }
      },

      write: async (entry) => {
        await this.#writeEntry(entry);
      },
    });
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Add an entry to the zip. If there is already something streaming to the
   * instance's {@link writable}, this method will throw a {@link TypeError}.
   * This method applies back pressure if the buffer is full.
   */
  public async addFile(entry: ZipEntry): Promise<void>;
  public async addFile(
    entry: ZipEntryInfo,
    content?: DataSource,
  ): Promise<void>;
  public async addFile(
    entry: ZipEntryInfo,
    content?: DataSource,
  ): Promise<void> {
    // crude mutex: we're using the internal continuation queue as our work queue
    this.#inputMutex = this.#inputMutex.then(async () => {
      const writer = this.#input.getWriter();
      try {
        await writer.write(
          entry instanceof ZipEntry ? entry : new ZipEntry(entry, content),
        );
      } finally {
        writer.releaseLock();
      }
    });
    await this.#inputMutex;
  }

  /**
   * Write the central directory and close the writer. No more entries can be
   * added after this is called.
   */
  public async close(): Promise<void> {
    await this.#inputMutex;
    await this.#input.close();
  }

  async #writeBytes(chunk: Uint8Array): Promise<void> {
    await this.#byteWriter.ready;
    // only wait if backpressure signalled, not on every write
    void this.#byteWriter.write(chunk);
    this.#currentOffset += chunk.length;
  }

  async #writeCentralDirectory(): Promise<void> {
    const directoryOffset = this.#currentOffset;
    let useZip64 = this.#centralDirectory.length > 0xffff;
    let versionNeeded: number = ZipVersion.Deflate;

    for (const entry of this.#centralDirectory) {
      useZip64 ||= !!entry.zip64;
      versionNeeded = Math.max(versionNeeded, entry.versionNeeded);
      await this.#writeBytes(entry.serialize());
    }

    const trailerOffset = this.#currentOffset;
    const directorySize = trailerOffset - directoryOffset;
    useZip64 ||= trailerOffset >= 0xffff_ffff;

    if (useZip64) {
      const eocdr64 = new Zip64Eocdr({
        entryCount: this.#centralDirectory.length,
        directoryStart: directoryOffset,
        directoryLength: directorySize,
        platformMadeBy: ZipPlatform.UNIX,
        versionMadeBy: versionNeeded,
        versionNeeded,
      });

      await this.#writeBytes(eocdr64.serialize());
      await this.#writeBytes(new Zip64Eocdl(trailerOffset).serialize());
    }

    const eocdr = new Eocdr(
      {
        comment: this.#comment,
        entryCount: this.#centralDirectory.length,
        directoryStart: directoryOffset,
        directoryLength: directorySize,
      },
      useZip64,
    );

    await this.#writeBytes(eocdr.serialize());
  }

  async #writeEntry(input: ZipEntryInfo): Promise<void> {
    const entry = input instanceof ZipEntry ? input : new ZipEntry(input);

    entry.header.localHeaderOffset = this.#currentOffset;
    const localHeader = new LocalFileHeader(entry);
    await this.#writeBytes(localHeader.serialize());

    for await (const chunk of entry.compressedData) {
      await this.#writeBytes(chunk);
    }

    if (localHeader.flags.hasDataDescriptor) {
      const dataDescriptor = new DataDescriptor(entry, entry.zip64);
      await this.#writeBytes(dataDescriptor.serialize());
    }

    this.#centralDirectory.push(entry.header);
  }
}
