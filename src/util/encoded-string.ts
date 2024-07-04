import { makeSubUint8Array, type BufferLike } from "./binary.js";
import { CodePage437Decoder, CodePage437Encoder } from "./cp437.js";

export type StringEncoding = "cp437" | "utf8";

function getDecoder(encoding: StringEncoding): TextDecoder {
  if (encoding === "cp437") {
    return new CodePage437Decoder();
  }
  if (encoding === "utf8") {
    return new TextDecoder();
  }
  throw new TypeError(
    `encoding should be "cp437" or "utf8" (got "${encoding as string}")`,
  );
}

function getEncoder(encoding: StringEncoding): TextEncoder {
  if (encoding === "cp437") {
    return new CodePage437Encoder();
  }
  if (encoding === "utf8") {
    return new TextEncoder();
  }
  throw new TypeError(
    `encoding should be "cp437" or "utf8" (got "${encoding as string}")`,
  );
}

export class EncodedString {
  public readonly rawValue: Uint8Array;
  public readonly encoding: StringEncoding;
  public readonly value: string;

  public get byteLength(): number {
    return this.rawValue.byteLength;
  }

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
    this.encoding = encoding;

    if (typeof bufferOrString === "string") {
      this.value = bufferOrString;
      this.rawValue = getEncoder(encoding).encode(this.value);
    } else {
      this.rawValue = makeSubUint8Array(bufferOrString, byteOffset, byteLength);
      this.value = getDecoder(encoding).decode(this.rawValue);
    }
  }

  public toString(): string {
    return this.value;
  }
}
