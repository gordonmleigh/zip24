const cp437 =
  "\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

const reverseCp437 = Object.fromEntries(
  [...cp437].map((value, index) => [value, index]),
);

export function canBeCodePage437Encoded(value: string): boolean {
  return [...value].every((char) => char in reverseCp437);
}

export class CodePage437Decoder implements TextDecoder {
  public readonly encoding = "cp437";
  public readonly fatal = false;
  public readonly ignoreBOM = true;

  public decode(
    input?: AllowSharedBufferSource,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- needed for interface
    options?: TextDecodeOptions,
  ): string {
    let result = "";

    if (!input) {
      return result;
    }

    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);

    for (const element of bytes) {
      // the array has 256 elements in it and `element` is a uint8
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      result += cp437[element]!;
    }
    return result;
  }
}

export class CodePage437Encoder implements TextEncoder {
  public readonly encoding = "cp437";

  public encode(input?: string): Uint8Array {
    // all cp-432 codepoints can be represented by a single UTF-16 value
    const destination = new Uint8Array(input?.length ?? 0);
    if (!input) {
      return destination;
    }
    this.encodeInto(input, destination);
    return destination;
  }

  public encodeInto(
    source: string,
    destination: Uint8Array,
  ): TextEncoderEncodeIntoResult {
    const input =
      destination.length >= source.length
        ? source
        : source.slice(0, destination.length);
    let index = 0;

    for (const char of input) {
      const codePoint = reverseCp437[char];
      if (codePoint === undefined) {
        throw new Error(
          `character "${char}" is not encodable in Code Page 437`,
        );
      }

      destination[index++] = codePoint;
    }

    return {
      read: index,
      written: index,
    };
  }
}
