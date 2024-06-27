import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { Semaphore } from "./semaphore.js";

describe("Semaphore", () => {
  describe("acquire()", () => {
    it("succeeds immediately if the value is higher than count", async () => {
      const semaphore = new Semaphore(10);

      // the test will die if this blocks
      await semaphore.acquire(5);
    });

    it("throws if the signal is already aborted", async () => {
      const controller = new AbortController();
      const semaphore = new Semaphore(10, { signal: controller.signal });

      controller.abort();
      await assert.rejects(() => semaphore.acquire(5));
    });

    it("waits if the count is higher than the value", async () => {
      // this feels hard to test, because we can't inspect the current state of
      // a promise – so lets just prove that it runs to the max concurrency
      // allowed by the semaphore value when we use it as a mutex
      const semaphore = new Semaphore(7);
      let simultaneous = 0;
      let maxSimultaneous = 0;
      const workers: Promise<void>[] = [];

      async function worker() {
        try {
          await semaphore.acquire();
          ++simultaneous;
          maxSimultaneous = Math.max(maxSimultaneous, simultaneous);
          // simulate some work with async callbacks
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        } finally {
          semaphore.release();
          --simultaneous;
        }
      }

      for (let n = 0; n < 500; ++n) {
        workers.push(worker());
      }

      await Promise.all(workers);
      assert.strictEqual(maxSimultaneous, 7);
    });

    it("throws if the signal is aborted while waiting", async () => {
      const controller = new AbortController();
      const semaphore = new Semaphore(0, { signal: controller.signal });

      const result = semaphore.acquire();
      controller.abort();
      await assert.rejects(() => result);
    });
  });

  describe("run()", () => {
    it("forwards the returned value", async () => {
      const semaphore = new Semaphore(42);
      const value = Symbol();
      const action = mock.fn(() => Promise.resolve(value));

      const result = await semaphore.run(action, 3);
      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(result, value);
    });

    it("acquires the cost before running the function", async () => {
      const semaphore = new Semaphore(42);
      let value = semaphore.value;

      const action = mock.fn(() => {
        value = semaphore.value;
        return Promise.resolve();
      });

      await semaphore.run(action, 3);
      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(value, 39);
    });

    it("releases the cost after running the function", async () => {
      const semaphore = new Semaphore(42);
      const action = mock.fn(() => Promise.resolve());

      await semaphore.run(action, 3);
      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(semaphore.value, 42);
    });

    it("releases the cost if the function throws", async () => {
      const semaphore = new Semaphore(42);
      const error = Symbol();

      const action = mock.fn(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw error;
      });

      await assert.rejects(
        () => semaphore.run(action, 3),
        (reason) => {
          assert.strictEqual(reason, error);
          return true;
        },
      );

      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(semaphore.value, 42);
    });
  });

  describe("synchronize()", () => {
    it("forwards the arguments", async () => {
      const semaphore = new Semaphore(42);
      const parameterValues = [Symbol(), Symbol(), Symbol()];
      const action = mock.fn((...parameters: unknown[]) =>
        Promise.resolve(parameters),
      );

      const wrapped = semaphore.synchronize(action);
      await wrapped(...parameterValues);

      assert.strictEqual(action.mock.callCount(), 1);
      assert.deepStrictEqual(action.mock.calls[0]?.arguments, parameterValues);
    });

    it("forwards the returned value", async () => {
      const semaphore = new Semaphore(42);
      const value = Symbol();
      const action = mock.fn(() => Promise.resolve(value));

      const wrapped = semaphore.synchronize(action, 3);
      const result = await wrapped();

      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(result, value);
    });

    it("acquires the cost before running the function", async () => {
      const semaphore = new Semaphore(42);
      let value = semaphore.value;

      const action = mock.fn(() => {
        value = semaphore.value;
        return Promise.resolve();
      });

      const wrapped = semaphore.synchronize(action, 3);
      await wrapped();

      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(value, 39);
    });

    it("releases the cost after running the function", async () => {
      const semaphore = new Semaphore(42);
      const action = mock.fn(() => Promise.resolve());

      const wrapped = semaphore.synchronize(action, 3);
      await wrapped();

      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(semaphore.value, 42);
    });

    it("releases the cost if the function throws", async () => {
      const semaphore = new Semaphore(42);
      const error = Symbol();

      const action = mock.fn(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw error;
      });

      const wrapped = semaphore.synchronize(action, 3);

      await assert.rejects(
        async () => await wrapped(),
        (reason) => {
          assert.strictEqual(reason, error);
          return true;
        },
      );

      assert.strictEqual(action.mock.callCount(), 1);
      assert.strictEqual(semaphore.value, 42);
    });
  });
});
