import assert from "node:assert";
import { describe, it } from "node:test";
import { Deferred } from "./deferred.js";

describe("Deferred", () => {
  it("resolve() resolves the promise", async () => {
    const deferred = new Deferred();
    const value = Symbol();

    deferred.resolve(value);
    const result = await deferred.promise;

    assert.strictEqual(result, value);
  });

  it("reject() rejects the promise", async () => {
    const deferred = new Deferred();
    const error = Symbol();

    deferred.reject(error);

    await assert.rejects(deferred.promise, (reason) => {
      assert.strictEqual(reason, error);
      return true;
    });
  });
});
