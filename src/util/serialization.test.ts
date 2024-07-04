import assert from "node:assert";
import { describe, it } from "node:test";
import { assertBufferEqual } from "../test-util/assert.js";
import { makeBuffer } from "./serialization.js";

describe("util/serialization", () => {
  describe("makeBuffer()", () => {
    describe("if buffer is not provided", () => {
      it("it allocates a buffer of the required length", () => {
        const buffer = makeBuffer(142, undefined);
        assert.strictEqual(buffer.byteLength, 142);
      });
    });

    describe("if buffer is provided", () => {
      it("throws if the buffer is shorter than the required length", () => {
        assert.throws(
          () => makeBuffer(10, Buffer.alloc(2)),
          (error) => error instanceof RangeError,
        );
      });

      it("throws if the byteLength is shorter than the required length", () => {
        assert.throws(
          () => makeBuffer(10, Buffer.alloc(10), 0, 2),
          (error) => error instanceof RangeError,
        );
      });

      it("returns from byteOffset up to the required length if no length is given", () => {
        const source = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        const buffer = makeBuffer(2, source, 5);

        assertBufferEqual(buffer.getOriginalBytes(), new Uint8Array([5, 6]));
      });
    });
  });
});
