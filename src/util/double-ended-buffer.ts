import { addAbortListener } from "./abort.js";
import { DisposedError } from "./disposable.js";

type StateEvent = "ended" | "readable" | "writable";
type FlowState = "drained" | "ended" | "flowing" | "paused" | "starved";

type Listener = () => void;

export type DoubleEndedBufferOptions = {
  readonly highWaterMark?: number;
};

export class DoubleEndedBuffer implements AsyncIterable<Uint8Array> {
  private readonly abortController = new AbortController();
  private readonly buffer: Uint8Array[] = [];
  private readonly highWaterMark: number | undefined;

  private readonly stateListeners: Record<StateEvent, Listener[]> = {
    ended: [],
    readable: [],
    writable: [],
  };

  private bufferSize = 0;
  private isClosed = false;
  private waitForDrain = false;

  private get isBufferWritable(): boolean {
    return (
      this.highWaterMark === undefined || this.bufferSize < this.highWaterMark
    );
  }

  public constructor(options: DoubleEndedBufferOptions = {}) {
    this.highWaterMark = options.highWaterMark;
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      const chunk = await this.read();
      if (chunk === undefined) {
        return;
      }
      yield chunk;
    }
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    if (!this.abortController.signal.aborted) {
      this.updateState();
    }
  }

  public async dispose(): Promise<void> {
    this.close();

    const pendingReads = this.stateListeners.readable.length > 0;
    const pendingWrites = this.stateListeners.writable.length > 0;

    if (pendingWrites && !pendingReads) {
      this.abortController.abort(new DisposedError());
    } else {
      await this.waitForState("ended");
    }
  }

  public async done(): Promise<void> {
    await this.waitForState("ended");
  }

  public async read(): Promise<Uint8Array | undefined> {
    await this.waitForState("readable");
    const result = this.buffer.shift();

    // result is undefined if the buffer is ending
    if (result !== undefined) {
      this.bufferSize -= result.byteLength;
      this.updateState();
    }

    return result;
  }

  public async write(chunk: Uint8Array): Promise<void> {
    if (this.isClosed) {
      throw new Error(`can't add data to an closed buffer`);
    }

    await this.waitForState("writable");

    this.buffer.push(chunk);
    this.bufferSize += chunk.byteLength;

    this.updateState();
  }

  private emitState(state: StateEvent): void {
    if (state === "ended") {
      if (!this.abortController.signal.aborted) {
        // release all pending reads
        const readers = this.stateListeners.readable;
        this.stateListeners.readable = [];

        for (const reader of readers) {
          reader();
        }
      }

      // release all 'ended' listeners
      const listeners = this.stateListeners.ended;
      this.stateListeners.ended = [];

      for (const listener of listeners) {
        listener();
      }
    } else {
      // just release a single listener
      /* c8 ignore next */
      this.stateListeners[state].shift()?.();
    }
  }

  private getFlowState(): FlowState {
    this.abortController.signal.throwIfAborted();

    const pendingReads = this.stateListeners.readable.length > 0;
    const pendingWrites = this.stateListeners.writable.length > 0;
    const ended = this.isClosed && !pendingWrites && this.buffer.length === 0;

    if (ended) {
      return "ended";
    }
    if (this.buffer.length === 0) {
      return pendingReads ? "starved" : "drained";
    }
    if (this.waitForDrain || !this.isBufferWritable) {
      return "paused";
    }
    return "flowing";
  }

  private isState(state: StateEvent, flowState = this.getFlowState()): boolean {
    switch (state) {
      case "ended":
        return flowState === "ended";
      case "readable":
        return (
          flowState === "flowing" ||
          flowState === "ended" ||
          flowState === "paused"
        );
      case "writable":
        return (
          flowState === "flowing" ||
          flowState === "starved" ||
          (this.isBufferWritable && flowState === "drained")
        );
    }
  }

  private updateState(): void {
    const flowState = this.getFlowState();

    if (flowState === "ended") {
      this.emitState("ended");
      return;
    }
    if (flowState === "paused") {
      this.waitForDrain = true;
    }
    if (flowState === "drained") {
      this.waitForDrain = false;
    }

    if (this.isState("readable", flowState)) {
      this.emitState("readable");
    }
    if (this.isState("writable", flowState)) {
      this.emitState("writable");
    }
  }

  private async waitForState(state: StateEvent): Promise<void> {
    if (this.isState(state) && this.stateListeners[state].length === 0) {
      // we already have this state and there's no-one else waiting
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = addAbortListener(this.abortController.signal, reject);

      this.stateListeners[state].push(() => {
        cleanup();
        resolve();
      });
    });
  }
}
