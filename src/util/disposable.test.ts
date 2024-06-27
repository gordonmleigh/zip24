import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { asyncDisposeOrClose } from "./disposable.js";

describe("asyncDisposeOrClose", () => {
  it("prefers [Symbol.dispose] to close", async () => {
    let hasWaited = false;

    const dispose = mock.fn(async () => {
      await Promise.resolve();
      hasWaited = true;
    });

    const close = mock.fn();

    const disposable = { [Symbol.dispose]: dispose, close };
    await asyncDisposeOrClose(disposable);

    assert.strictEqual(close.mock.callCount(), 0);
    assert.strictEqual(dispose.mock.callCount(), 1);
    assert.strictEqual(hasWaited, true);
  });

  it("prefers [Symbol.asyncDispose] to [Symbol.dispose]", async () => {
    let hasWaited = false;

    const asyncDispose = mock.fn(async () => {
      await Promise.resolve();
      hasWaited = true;
    });

    const dispose = mock.fn();

    const disposable = {
      [Symbol.asyncDispose]: asyncDispose,
      [Symbol.dispose]: dispose,
      close: undefined,
    };

    await asyncDisposeOrClose(disposable);

    assert.strictEqual(dispose.mock.callCount(), 0);
    assert.strictEqual(asyncDispose.mock.callCount(), 1);
    assert.strictEqual(hasWaited, true);
  });

  it("prefers [Symbol.asyncDispose] to close", async () => {
    let hasWaited = false;

    const asyncDispose = mock.fn(async () => {
      await Promise.resolve();
      hasWaited = true;
    });

    const close = mock.fn();

    const disposable = {
      [Symbol.asyncDispose]: asyncDispose,
      close,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    };

    await asyncDisposeOrClose(disposable);
    assert.strictEqual(close.mock.callCount(), 0);
    assert.strictEqual(asyncDispose.mock.callCount(), 1);
    assert.strictEqual(hasWaited, true);
  });

  it("does nothing if the underlying disposable has no close method", async () => {
    const disposable = {};
    await asyncDisposeOrClose(disposable);
  });

  it("calls close if there's disposable protocol methods", async () => {
    let hasWaited = false;

    const close = mock.fn(async () => {
      await Promise.resolve();
      hasWaited = true;
    });

    const disposable = { close };
    await asyncDisposeOrClose(disposable);

    assert.strictEqual(close.mock.callCount(), 1);
    assert.strictEqual(hasWaited, true);
  });
});
