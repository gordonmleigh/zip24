import { assert } from "./assert.js";

type BufferedValue<T> = {
  size: number;
  value: T;
};

type WaitingValue<T> = {
  size: number;
  release: () => T;
};

export type DoubleEndedBufferOptions<T> = {
  readonly highWaterMark?: number;
  readonly size?: (value: T) => number;
};

export class ByteLengthStrategy<T extends ArrayBuffer | ArrayBufferView>
  implements Required<DoubleEndedBufferOptions<T>>
{
  public constructor(public readonly highWaterMark = 0x1000) {}

  public size(value: T): number {
    return value.byteLength;
  }
}
export class DoubleEndedBuffer<T> implements AsyncIterable<T> {
  private readonly buffer: BufferedValue<T>[] = [];
  private readonly capacity: number;
  private readonly getSize: (value: T) => number;
  private readonly waitingReaders: ((data?: T) => void)[] = [];
  private readonly waitingWriters: WaitingValue<T>[] = [];

  private bufferSize = 0;
  private consumerCountInternal = 0;
  private endedInternal = false;
  private errorInternal?: Error;
  private rejectEverything!: (error: Error) => void;
  private signalEnded!: () => void;
  private writtenBytesInternal = 0;

  private readonly endedPromise = new Promise<void>((resolve) => {
    this.signalEnded = resolve;
  });

  private readonly errorPromise = new Promise<undefined>((_, reject) => {
    this.rejectEverything = reject;
  });

  public get ended(): boolean {
    return this.endedInternal;
  }

  public get error(): Error | undefined {
    return this.errorInternal;
  }

  public get hasConsumers(): boolean {
    return this.consumerCountInternal > 0;
  }

  public get writtenBytes(): number {
    return this.writtenBytesInternal;
  }

  public constructor(options: DoubleEndedBufferOptions<T> = {}) {
    const { highWaterMark = 10, size = () => 1 } = options;
    this.capacity = highWaterMark;
    this.getSize = size;
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    try {
      ++this.consumerCountInternal;

      for (;;) {
        const chunk = await this.read();
        if (chunk === undefined) {
          break;
        }
        yield chunk;
      }
    } finally {
      --this.consumerCountInternal;
    }
  }

  public abort(error = new Error(`aborted`)): void {
    this.errorInternal = error;
    this.rejectEverything(error);
  }

  public end(): void {
    this.endedInternal = true;

    const readers = this.waitingReaders.slice(0, this.waitingReaders.length);
    for (const reader of readers) {
      reader();
    }

    if (this.buffer.length === 0 && this.waitingWriters.length === 0) {
      // there's nothing waiting to be read, so we're done here
      this.signalEnded();
    }
  }

  public async endAndWait(): Promise<void> {
    if (!this.endedInternal) {
      this.end();
    }
    await this.waitForEnd();
  }

  public async read(): Promise<T | undefined> {
    if (this.errorInternal) {
      throw this.errorInternal;
    }
    if (this.buffer.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const chunk = this.buffer.shift()!;
      this.bufferSize -= chunk.size;

      // move chunks from the queue to the buffer to fill it up again
      while (this.waitingWriters.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const waiter = this.waitingWriters[0]!;
        if (this.bufferSize + waiter.size < this.capacity) {
          this.waitingWriters.shift();
          const value = waiter.release();
          this.buffer.push({ value, size: waiter.size });
          this.bufferSize += waiter.size;
        } else {
          break;
        }
      }

      return chunk.value;
    }

    // we'll get here if the waiting chunk is bigger than the capacity
    if (this.waitingWriters.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const waiter = this.waitingWriters[0]!;
      return waiter.release();
    }

    if (this.ended) {
      // there is nothing left to be read, so we're done here
      this.signalEnded();
      return;
    }

    // nothing to read for now, so wait for a chunk
    return await Promise.race([
      this.errorPromise,
      new Promise<T | undefined>((resolve) => {
        this.waitingReaders.push(resolve);
      }),
    ]);
  }

  public async waitForEnd(): Promise<void> {
    await this.endedPromise;
  }

  public async write(value: T): Promise<void> {
    if (this.errorInternal) {
      throw this.errorInternal;
    }
    assert(!this.endedInternal, `can't add data to an ended buffer`);

    const size = this.getSize(value);
    this.writtenBytesInternal += size;

    if (this.waitingReaders.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const reader = this.waitingReaders.shift()!;
      reader(value);
      return;
    }

    if (this.bufferSize + size <= this.capacity) {
      this.buffer.push({ size, value });
      this.bufferSize += size;
      return;
    }

    await Promise.race([
      this.errorPromise,
      new Promise<void>((resolve) => {
        this.waitingWriters.push({
          release: () => {
            resolve();
            return value;
          },
          size,
        });
      }),
    ]);
  }
}

export type Task = () => void | PromiseLike<void>;

export class TaskQueue extends DoubleEndedBuffer<Task> {
  public constructor(capacity: number) {
    super({ highWaterMark: capacity });
  }

  public async run(): Promise<void> {
    try {
      for await (const task of this) {
        await task();
      }
    } catch (error) {
      this.abort(error as Error);
      throw error;
    }
  }
}
