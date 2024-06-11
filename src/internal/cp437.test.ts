import assert from "node:assert";
import { describe, it } from "node:test";
import { CodePage437Decoder, CodePage437Encoder } from "./cp437.js";

describe("CodePage437Decoder", () => {
  describe("decode()", () => {
    it("returns an empty string if input is undefined", () => {
      const decoder = new CodePage437Decoder();

      const result = decoder.decode();
      assert.strictEqual(result, "");
    });

    it("can successfully decode a UInt8Array", () => {
      // make sure it respects the view bounds
      const input = new Uint8Array(makeAllCodePointBuffer(true), 10, 256);
      const decoder = new CodePage437Decoder();

      const result = decoder.decode(input);
      assert.strictEqual(result, allCodePoints);
    });

    it("can successfully decode an ArrayBuffer", () => {
      const input = makeAllCodePointBuffer();
      const decoder = new CodePage437Decoder();

      const result = decoder.decode(input);
      assert.strictEqual(result, allCodePoints);
    });
  });
});

describe("CodePage437Decoder", () => {
  describe("encode()", () => {
    it("returns an empty array if input is undefined", () => {
      const encoder = new CodePage437Encoder();
      const result = encoder.encode();
      assert.strictEqual(result.byteLength, 0);
    });

    it("returns an array of code points", () => {
      const encoder = new CodePage437Encoder();
      const result = encoder.encode(allCodePoints);

      assert.strictEqual(result.byteLength, 256);

      for (let index = 0; index < 256; ++index) {
        assert.strictEqual(result[index], index);
      }
    });

    it("throws an error if the codepoint cannot be encoded", () => {
      const encoder = new CodePage437Encoder();
      assert.throws(() => encoder.encode("🫠"));
    });
  });

  describe("encodeInto", () => {
    it("only encodes up to the length of the destination buffer", () => {
      const encoder = new CodePage437Encoder();
      const destination = new Uint8Array(3);

      const result = encoder.encodeInto("ABCDEF", destination);

      assert.strictEqual(result.read, 3);
      assert.strictEqual(result.written, 3);
      assert.deepStrictEqual(destination, new Uint8Array([65, 66, 67]));
    });
  });
});

const allCodePoints =
  "\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function makeAllCodePointBuffer(garbage = false): ArrayBuffer {
  const buffer = new ArrayBuffer(garbage ? 276 : 256);
  const view = new Uint8Array(buffer);
  let index = 0;

  if (garbage) {
    // add garbage at the start
    for (; index < 10; ++index) {
      view[index] = 120; // 'x'
    }
  }

  for (let n = 0; n < 256; ++index, ++n) {
    view[index] = n;
  }

  if (garbage) {
    // add garbage at the end
    for (; index < 276; ++index) {
      view[index] = 120; // 'x'
    }
  }

  return buffer;
}
