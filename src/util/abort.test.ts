import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { addAbortListener } from "./abort.js";

describe("addAbortListener", () => {
  it("calls the listener if the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = Symbol();
    controller.abort(reason);

    const listener = mock.fn();
    addAbortListener(controller.signal, listener);

    // assert that the listener is not called immediately
    assert.strictEqual(listener.mock.callCount(), 0);

    // continuations are processed in order, so this will resolve after the
    // listener call
    await Promise.resolve();
    assert.strictEqual(listener.mock.callCount(), 1);
    assert.strictEqual(listener.mock.calls[0]?.arguments[0], reason);
  });

  it("calls the listener when the signal is aborted", async () => {
    const controller = new AbortController();
    const reason = Symbol();

    const listener = mock.fn();
    addAbortListener(controller.signal, listener);

    // assert that the listener is not called immediately
    assert.strictEqual(listener.mock.callCount(), 0);

    await Promise.resolve();
    controller.abort(reason);

    // the listener is called immediately (synchronously) on abort
    assert.strictEqual(listener.mock.callCount(), 1);
    assert.strictEqual(listener.mock.calls[0]?.arguments[0], reason);
  });

  it("returns a function which de-registers the listener", async () => {
    const controller = new AbortController();
    const reason = Symbol();

    const listener = mock.fn();
    const handler = addAbortListener(controller.signal, listener);
    handler();

    await Promise.resolve();
    controller.abort(reason);
    await Promise.resolve();

    assert.strictEqual(listener.mock.callCount(), 0);
  });
});
