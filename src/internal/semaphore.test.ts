import assert from "node:assert";
import { describe, it } from "node:test";
import { Semaphore } from "./semaphore.js";

describe("Semaphore", () => {
  describe("acquire()", () => {
    it("succeeds immediately if the value is higher than count", async () => {
      const semaphore = new Semaphore(10);

      // the test will die if this blocks
      await semaphore.acquire(5);
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
  });
});
