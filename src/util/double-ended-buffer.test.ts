import assert from "node:assert";
import { describe, it } from "node:test";
import { DisposedError } from "./disposable.js";
import { DoubleEndedBuffer } from "./double-ended-buffer.js";
import { textFromIterable } from "./streams.js";

describe("util/double-ended-buffer", () => {
  describe("class DoubleEndedBuffer", () => {
    describe("#write()", () => {
      it("buffers chunks up to the high water mark", async () => {
        const buffer = new DoubleEndedBuffer({ highWaterMark: 10 });

        await buffer.write(Buffer.from("01234"));
        await buffer.write(Buffer.from("56789"));

        const writer = buffer.write(Buffer.from("1"));

        await Promise.all([
          buffer.dispose(),
          assert.rejects(writer, (error) => error instanceof DisposedError),
        ]);
      });

      it("forwards all chunks to the reader", async () => {
        const data = [
          Buffer.from("hello"),
          Buffer.from(" "),
          Buffer.from("world"),
        ];
        await using buffer = new DoubleEndedBuffer();

        void Promise.all(data.map((x) => buffer.write(x)));
        buffer.close();

        const result = await textFromIterable(buffer);

        assert.strictEqual(result, "hello world");
      });

      it("throws if called after close()", async () => {
        await using buffer = new DoubleEndedBuffer();
        buffer.close();

        await assert.rejects(buffer.write(Buffer.from("one")));
      });
    });

    describe("#close()", () => {
      it("resolves pending reads", async () => {
        await using buffer = new DoubleEndedBuffer({ highWaterMark: 0 });

        const reader1 = buffer.read();
        const reader2 = buffer.read();
        buffer.close();

        assert.strictEqual(await reader1, undefined);
        assert.strictEqual(await reader2, undefined);
      });
    });

    describe("#done()", () => {
      it("resolves when the buffer is closed", async () => {
        const buffer = new DoubleEndedBuffer({ highWaterMark: 0 });
        const done = buffer.done();

        buffer.close();
        await done;
      });

      it("rejects when dispose() is called with pending writes", async () => {
        const buffer = new DoubleEndedBuffer({ highWaterMark: 0 });
        const write = buffer.write(Buffer.from("hello"));
        const dispose = buffer.dispose();
        const done = buffer.done();

        await Promise.all([
          assert.rejects(write, (cause) => cause instanceof DisposedError),
          assert.rejects(done, (cause) => cause instanceof DisposedError),
          assert.doesNotReject(dispose),
        ]);
      });
    });

    describe("#dispose()", () => {
      it("resolves pending reads with undefined", async () => {
        const buffer = new DoubleEndedBuffer({ highWaterMark: 0 });

        const reader1 = buffer.read();
        const reader2 = buffer.read();

        await buffer.dispose();

        assert.strictEqual(await reader1, undefined);
        assert.strictEqual(await reader2, undefined);
      });

      it("rejects pending writes and resolves successfully", async () => {
        const buffer = new DoubleEndedBuffer({ highWaterMark: 0 });
        const write = buffer.write(Buffer.from("hello"));
        const dispose = buffer.dispose();

        await Promise.all([
          assert.rejects(write, (cause) => cause instanceof DisposedError),
          assert.doesNotReject(dispose),
        ]);
      });
    });
  });
});
