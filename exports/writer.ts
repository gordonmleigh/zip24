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
  comment?: string | undefined;
  destination?: WritableStream<Uint8Array> | undefined;
  preventClose?: boolean | undefined;
  startingOffset?: number | undefined;
};

/**
 * A class which can create a zip file.
 */
export class ZipWriter
  implements TransformStream<ZipEntry, Uint8Array>, AsyncDisposable
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
  readonly #preventClose: boolean;
  readonly #readable: ReadableStream<Uint8Array> | undefined;
  readonly #startingOffset: number;
  readonly #writable: WritableStream<ZipEntry>;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  #writtenBytes = 0;

  public get readable(): ReadableStream<Uint8Array> {
    assert(
      this.#readable,
      `the stream is not readable when a destination has been supplied`,
    );
    return this.#readable;
  }

  public get writable(): WritableStream<ZipEntry> {
    return this.#writable;
  }

  public constructor(options: ZipWriterOptions = {}) {
    this.#comment = options.comment ?? "";
    this.#startingOffset = options.startingOffset ?? 0;

    if (options.destination) {
      this.#preventClose = options.preventClose ?? false;
      this.#writer = options.destination.getWriter();
    } else {
      const buffer = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          this.#writtenBytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });

      this.#preventClose = false;
      this.#readable = buffer.readable;
      this.#writer = buffer.writable.getWriter();
    }

    this.#writable = new WritableStream({
      abort: async (reason) => {
        await this.#writer.abort(reason);
      },

      close: async () => {
        await this.#writeCentralDirectory();

        if (this.#preventClose) {
          this.#writer.releaseLock();
        } else {
          await this.#writer.close();
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
    // use the writable's built-in synchronization via the writer
    const writer = this.#writable.getWriter();
    try {
      assert(writer.desiredSize, `the stream is closed or errored`);
      if (writer.desiredSize < 0) {
        await writer.ready;
      }
      await writer.write(
        entry instanceof ZipEntry ? entry : new ZipEntry(entry, content),
      );
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Write the central directory and close the writer. No more entries can be
   * added after this is called.
   */
  public async close(): Promise<void> {
    await this.#writable.close();
  }

  async #write(chunk: Uint8Array): Promise<void> {
    assert(this.#writer.desiredSize !== null);

    if (this.#writer.desiredSize < 0) {
      await this.#writer.ready;
    }
    await this.#writer.write(chunk);
  }

  async #writeCentralDirectory(): Promise<void> {
    const directoryOffset = this.#startingOffset + this.#writtenBytes;
    let useZip64 = this.#centralDirectory.length > 0xffff;
    let versionNeeded: number = ZipVersion.Deflate;

    for (const entry of this.#centralDirectory) {
      useZip64 ||= !!entry.zip64;
      versionNeeded = Math.max(versionNeeded, entry.versionNeeded);
      await this.#write(entry.serialize());
    }

    const trailerOffset = this.#startingOffset + this.#writtenBytes;
    const directorySize = trailerOffset - directoryOffset;
    useZip64 ||= trailerOffset >= 0xffff_ffff;

    if (useZip64) {
      const eocdr64 = new Zip64Eocdr({
        count: this.#centralDirectory.length,
        offset: directoryOffset,
        size: directorySize,
        platformMadeBy: ZipPlatform.UNIX,
        versionMadeBy: versionNeeded,
        versionNeeded,
      });

      await this.#write(eocdr64.serialize());
      await this.#write(new Zip64Eocdl(trailerOffset).serialize());
    }

    const eocdr = new Eocdr(
      {
        comment: this.#comment,
        count: this.#centralDirectory.length,
        offset: directoryOffset,
        size: directorySize,
      },
      useZip64,
    );

    await this.#write(eocdr.serialize());
  }

  async #writeEntry(entry: ZipEntry): Promise<void> {
    const localHeader = new LocalFileHeader(entry);
    // always write data descriptor
    localHeader.flags.hasDataDescriptor = true;
    await this.#write(localHeader.serialize());

    for await (const chunk of entry.compressedData) {
      await this.#write(chunk);
    }

    const dataDescriptor = new DataDescriptor(entry, entry.zip64);
    await this.#write(dataDescriptor.serialize());

    this.#centralDirectory.push(entry.header);
  }
}
