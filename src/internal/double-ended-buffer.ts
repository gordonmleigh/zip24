import { Deferred } from "./deferred.js";
import { Semaphore } from "./semaphore.js";

type MeasuredItem<T> = {
  size: number;
  value: T;
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
  private readonly abortController = new AbortController();
  private readonly buffer: MeasuredItem<T>[] = [];
  private readonly endedInternal = new Deferred<void>();
  private readonly getSize: (value: T) => number;
  private readonly highWaterMark: number;
  private readonly readableItems: Semaphore;
  private readonly writableCapacity: Semaphore;

  private consumerCountInternal = 0;
  private isEndedInternal = false;
  private writtenBytesInternal = 0;

  public get ended(): PromiseLike<void> {
    return this.endedInternal.promise;
  }

  public get error(): Error | undefined {
    return this.signal.reason as Error;
  }

  public get isEnded(): boolean {
    return this.isEndedInternal;
  }

  public get hasConsumers(): boolean {
    return this.consumerCountInternal > 0;
  }

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public get writtenBytes(): number {
    return this.writtenBytesInternal;
  }

  public constructor(options: DoubleEndedBufferOptions<T> = {}) {
    const { highWaterMark = 10, size = () => 1 } = options;

    // this semaphore signals available items in the buffer for readers
    this.readableItems = new Semaphore(0, { signal: this.signal });
    // this semaphore signals available capacity in the buffer for writers
    this.writableCapacity = new Semaphore(highWaterMark, {
      signal: this.signal,
    });

    this.getSize = size;
    this.highWaterMark = highWaterMark;
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

  public abort(error?: Error): void {
    this.abortController.abort(error);
  }

  public end(): void {
    this.isEndedInternal = true;

    if (this.buffer.length === 0) {
      // signal phantom buffer item to let readers drain
      this.readableItems.release();
      this.endedInternal.resolve();
    }
  }

  public async read(): Promise<T | undefined> {
    if (this.isEndedInternal && this.buffer.length === 0) {
      // short circuit if buffer is empty and stream is empty
      return;
    }
    await this.readableItems.acquire();
    const item = this.buffer.shift();

    if (item) {
      this.writableCapacity.release(Math.min(this.highWaterMark, item.size));
      return item.value;
    }

    if (this.isEndedInternal) {
      // we didn't read anything here so we can signal that we're done
      this.endedInternal.resolve();
      // release the next reader so that reader list can drain
      this.readableItems.release();
    }
  }

  public async write(value: T): Promise<void> {
    if (this.isEndedInternal) {
      throw new Error(`can't add data to an ended buffer`);
    }

    const size = this.getSize(value);
    this.writtenBytesInternal += size;

    // only try to acquire up to the total capacity to avoid blocking forever
    await this.writableCapacity.acquire(Math.min(this.highWaterMark, size));
    this.buffer.push({ size, value });
    this.readableItems.release();
  }
}
