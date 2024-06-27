import assert from "node:assert";
import { text } from "node:stream/consumers";
import { describe, it } from "node:test";
import {
  ByteLengthStrategy,
  DoubleEndedBuffer,
} from "./double-ended-buffer.js";

describe("DoubleEndedBuffer", () => {
  it("buffers chunks up to the high water mark", async () => {
    const buffer = new DoubleEndedBuffer(new ByteLengthStrategy(10));

    await buffer.write(Buffer.from("01234"));
    await buffer.write(Buffer.from("56789"));

    assert.strictEqual(buffer.written, 10);

    const promise = buffer.write(Buffer.from("1"));

    promise.then(
      () => {
        assert(false, "expected promise not to resolve");
      },
      () => {
        assert(false, "expected promise not to reject");
      },
    );
  });

  it("forwards all chunks to the reader", async () => {
    const data = [Symbol(), Symbol(), Symbol(), Symbol()];
    const buffer = new DoubleEndedBuffer();

    const writers = Promise.all(data.map((x) => buffer.write(x)));
    buffer.end();
    assert.strictEqual(buffer.isEnded, true);

    const read: unknown[] = [];
    for await (const chunk of buffer) {
      read.push(chunk);
    }

    await writers;
    await buffer.ended;
    assert.deepStrictEqual(read, data);
  });

  it("throws if write() is called after end()", async () => {
    const buffer = new DoubleEndedBuffer();
    buffer.end();
    assert.strictEqual(buffer.isEnded, true);

    // also throws before end is signalled
    await assert.rejects(buffer.write(1));
    await buffer.ended;
    await assert.rejects(buffer.write(1));
  });

  it("rejects pending reads if the buffer is aborted", async () => {
    const buffer = new DoubleEndedBuffer();
    const error = new Error("bang!");
    const reader = buffer.read();

    buffer.abort(error);

    await assert.rejects(reader, (cause) => {
      assert.strictEqual(cause, error);
      return true;
    });

    assert.strictEqual(buffer.error, error);
  });

  it("rejects new reads if the buffer is aborted", async () => {
    const buffer = new DoubleEndedBuffer();
    const error = new Error("bang!");
    buffer.abort(error);

    await assert.rejects(buffer.read(), (cause) => {
      assert.strictEqual(cause, error);
      return true;
    });

    assert.strictEqual(buffer.error, error);
  });

  it("rejects pending writes if the buffer is aborted", async () => {
    const buffer = new DoubleEndedBuffer({ highWaterMark: 0 });
    const error = new Error("bang!");
    const writer = buffer.write(1);

    buffer.abort(error);

    await assert.rejects(writer, (cause) => {
      assert.strictEqual(cause, error);
      return true;
    });

    assert.strictEqual(buffer.error, error);
  });

  it("rejects new writes if the buffer is aborted", async () => {
    const buffer = new DoubleEndedBuffer({ highWaterMark: 0 });
    const error = new Error("bang!");
    buffer.abort(error);

    await assert.rejects(buffer.write(1), (cause) => {
      assert.strictEqual(cause, error);
      return true;
    });

    assert.strictEqual(buffer.error, error);
  });

  describe("pipeFrom()", () => {
    it("writes all chunks from the source", async () => {
      const buffer = new DoubleEndedBuffer(new ByteLengthStrategy(10));
      const outputPromise = text(buffer);

      // write this first to help prove that the correct value is returned by
      // pipeFrom
      await buffer.write(Buffer.from("01234"));

      const result = await buffer.pipeFrom([
        Buffer.from("hello"),
        Buffer.from("world"),
      ]);
      assert.strictEqual(result, 10);
      assert.strictEqual(buffer.written, 15);

      buffer.end();
      const output = await outputPromise;

      assert.strictEqual(output, "01234helloworld");
    });
  });
});
