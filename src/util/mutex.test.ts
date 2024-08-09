import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Mutex } from "./mutex.js";

describe("util/mutex", () => {
  describe("class Mutex", () => {
    describe("synchronize", () => {
      it("calls enter() and exit() around the action", async () => {
        const mutex = new Mutex();
        const enter = mock.method(mutex, "enter");
        const exit = mock.method(mutex, "exit");

        let proceed!: () => void;
        const promise = new Promise<void>((resolve) => {
          proceed = resolve;
        });

        const action = mock.fn(async () => {
          await promise;
        });

        const wrapped = mutex.synchronize(action);
        const run = wrapped();

        assert.strictEqual(enter.mock.callCount(), 1);
        assert.strictEqual(exit.mock.callCount(), 0);

        proceed();

        await run;
        assert.strictEqual(enter.mock.callCount(), 1);
        assert.strictEqual(exit.mock.callCount(), 1);
      });

      it("queues further callers while locked", async () => {
        const mutex = new Mutex();

        let proceed!: () => void;
        const promise = new Promise<void>((resolve) => {
          proceed = resolve;
        });

        const action = mock.fn(async () => {
          await promise;
        });

        const wrapped = mutex.synchronize(action);

        const run1 = wrapped();
        const run2 = wrapped();

        const result1 = await Promise.race([
          // timeout happens after all continuations have run
          setTimeout(0).then(() => "timeout"),
          run1.then(() => "run1"),
          run2.then(() => "run2"),
        ]);

        assert.strictEqual(result1, "timeout");

        proceed();

        const result2 = await Promise.race([
          setTimeout(0).then(() => "timeout"),
          run1.then(() => "run1"),
          run2.then(() => "run2"),
        ]);
        assert.strictEqual(result2, "run1");

        await run2;
      });
    });
  });
});
