import assert from "node:assert";
import { describe, it } from "node:test";
import { assertBufferEqual } from "../test-util/assert.js";
import { data } from "../test-util/data.js";
import { EncodedString } from "./encoded-string.js";

describe("util/encoded-string", () => {
  describe("class EncodedString", () => {
    describe("#constructor()", () => {
      describe("with cp437 encoding", () => {
        it("sets the value if given as string", () => {
          const encoded = new EncodedString("cp437", "♥♦♣♠");
          assertBufferEqual(encoded, data("03040506"));
        });

        it("sets the value if given as bytes", () => {
          const encoded = new EncodedString("cp437", data("fbfcfdfe"));
          assert.strictEqual(encoded.toString(), "√ⁿ²■");
        });
      });

      describe("with utf8 encoding", () => {
        it("sets the value if given as string", () => {
          const encoded = new EncodedString("utf8", "1️⃣");
          assertBufferEqual(encoded, data("31efb88fe283a3"));
        });

        it("sets the value if given as bytes", () => {
          const encoded = new EncodedString("utf8", data("f09f9982"));
          assert.strictEqual(encoded.toString(), "🙂");
        });
      });

      describe("with an invalid encoding", () => {
        it("throws if given the value as a string", () => {
          assert.throws(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            () => new EncodedString("blah" as any, ""),
            (error) =>
              error instanceof TypeError &&
              error.message ===
                'encoding should be "cp437" or "utf8" (got "blah")',
          );
        });

        it("throws if given the value as a buffer", () => {
          assert.throws(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            () => new EncodedString("blah" as any, data("010203")),
            (error) =>
              error instanceof TypeError &&
              error.message ===
                'encoding should be "cp437" or "utf8" (got "blah")',
          );
        });
      });
    });

    describe(".toString()", () => {
      it("returns the string value", () => {
        const encoded = new EncodedString("utf8", "1️⃣");
        assert.strictEqual(encoded.toString(), "1️⃣");
      });
    });
  });
});
