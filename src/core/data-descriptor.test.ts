import { describe, it } from "node:test";
import { assertBufferEqual } from "../test-util/assert.js";
import { bigUint, data, longUint } from "../test-util/data.js";
import { DataDescriptor } from "./data-descriptor.js";

describe("core/data-descriptor", () => {
  describe("DataDescriptor", () => {
    describe("#serialize()", () => {
      it("can serialize a 32-bit descriptor", () => {
        const descriptor = new DataDescriptor({
          compressedSize: 0x12345678,
          crc32: 0x11223344,
          uncompressedSize: 0x87654321,
        });

        const result = descriptor.serialize();

        assertBufferEqual(
          result,
          data(
            longUint(0x08074b50), // signature
            longUint(0x11223344), // crc32
            longUint(0x12345678), // compressed size
            longUint(0x87654321), // uncompressed size
          ),
        );
      });

      it("can serialize a 64-bit descriptor", () => {
        const descriptor = new DataDescriptor(
          {
            compressedSize: 0xaabb12345678,
            crc32: 0x11223344,
            uncompressedSize: 0xaabb87654321,
          },
          true,
        );

        const result = descriptor.serialize();

        assertBufferEqual(
          result,
          data(
            longUint(0x08074b50), // signature
            longUint(0x11223344), // crc32
            bigUint(0xaabb12345678), // compressed size
            bigUint(0xaabb87654321), // uncompressed size
          ),
        );
      });
    });
  });
});
