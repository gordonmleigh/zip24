import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { lazy } from "./lazy.js";

describe("lazy", () => {
  it("calls the factory on first use", () => {
    const value = Symbol();
    const factory = mock.fn(() => value);

    const instance = lazy(factory);
    assert.strictEqual(factory.mock.callCount(), 0);

    const result = instance();
    assert.strictEqual(result, value);
    assert.strictEqual(factory.mock.callCount(), 1);
  });

  it("calls the factory only once", () => {
    const value = Symbol();
    const factory = mock.fn(() => value);
    const instance = lazy(factory);

    const result1 = instance();
    assert.strictEqual(result1, value);
    assert.strictEqual(factory.mock.callCount(), 1);

    const result2 = instance();
    assert.strictEqual(result2, value);
    assert.strictEqual(factory.mock.callCount(), 1);
  });
});
