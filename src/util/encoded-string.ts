import { normalizeBufferRange, type BufferLike } from "./binary.js";
import { CodePage437Decoder, CodePage437Encoder } from "./cp437.js";

export type StringEncoding = "cp437" | "utf8";

function getDecoder(encoding: StringEncoding): TextDecoder {
  validateEncoding(encoding);
  if (encoding === "cp437") {
    return new CodePage437Decoder();
  }
  return new TextDecoder();
}

function getEncoder(encoding: StringEncoding): TextEncoder {
  validateEncoding(encoding);
  if (encoding === "cp437") {
    return new CodePage437Encoder();
  }
  return new TextEncoder();
}

function validateEncoding(
  encoding: string,
): asserts encoding is StringEncoding {
  if (encoding !== "cp437" && encoding !== "utf8") {
    throw new TypeError(
      `encoding should be "cp437" or "utf8" (got "${encoding}")`,
    );
  }
}

export class EncodedString extends Uint8Array {
  public readonly encoding: StringEncoding;

  public constructor(encoding: StringEncoding, value: string | BufferLike);
  public constructor(
    encoding: StringEncoding,
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  );
  public constructor(
    encoding: StringEncoding,
    bufferOrString: string | BufferLike,
    byteOffset = 0,
    byteLength?: number,
  ) {
    validateEncoding(encoding);

    if (typeof bufferOrString === "string") {
      super(getEncoder(encoding).encode(bufferOrString));
    } else {
      super(...normalizeBufferRange(bufferOrString, byteOffset, byteLength));
    }
    this.encoding = encoding;
  }

  public override toString(): string {
    return getDecoder(this.encoding).decode(this);
  }
}
