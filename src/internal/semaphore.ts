import { addAbortListener } from "./abort.js";

export type SemaphoreOptions = {
  signal?: AbortSignal;
};

type Waiter = {
  count: number;
  release: () => void;
};

/**
 * Implements a semaphore that can acquire or release arbitrary counts.
 */
export class Semaphore {
  private readonly waiters: Waiter[] = [];
  private readonly signal?: AbortSignal;
  private valueInternal: number;

  public constructor(initialVale = 0, options?: SemaphoreOptions) {
    this.signal = options?.signal;
    this.valueInternal = initialVale;
  }

  /**
   * Decrement the value of the semaphore by the given count (defaults to 1). If
   * the new value of the semaphore is negative, the promise will not be
   * resolved until the value becomes zero or greater. Earlier calls are
   * guaranteed to resolve before later calls, regardless of the value of
   * `count`.
   */
  public async acquire(count = 1): Promise<void> {
    this.signal?.throwIfAborted();

    if (this.waiters.length === 0 && count <= this.valueInternal) {
      // we've got enough value left, use it up and don't block
      this.valueInternal -= count;
    } else {
      // we don't have enough left, wait until we do
      await new Promise<void>((resolve, reject) => {
        let cancelAbort: () => void;

        // if we have an AbortSignal, then also register a callback to reject
        // the promise on abort
        if (this.signal) {
          cancelAbort = addAbortListener(this.signal, reject);
        }

        // add a new waiter to the queue
        this.waiters.push({
          count,
          release: () => {
            cancelAbort?.();
            resolve();
          },
        });
      });
    }
  }

  /**
   * Increment the value of the semaphore by the given count (defaults to 1).
   * Then, release as many waiters (callers to {@link acquire}) as possible
   * before the internal value becomes negative.
   */
  public release(count = 1): void {
    this.valueInternal += count;

    // release as many waiters as we can
    while (this.valueInternal > 0) {
      const head = this.waiters[0];
      if (head === undefined || this.valueInternal < head.count) {
        break;
      } else {
        // the value is now large enough to release the first waiter
        this.valueInternal -= head.count;
        this.waiters.shift();
        head.release();
      }
    }
  }

  public async run<T>(action: () => PromiseLike<T>, cost = 1): Promise<T> {
    try {
      await this.acquire(cost);
      return await action();
    } finally {
      this.release(cost);
    }
  }

  public synchronize<T, A extends unknown[]>(
    action: (...parameters: A) => PromiseLike<T>,
    cost = 1,
  ): (...parameters: A) => PromiseLike<T> {
    return (...parameters: A) => this.run(() => action(...parameters), cost);
  }
}
