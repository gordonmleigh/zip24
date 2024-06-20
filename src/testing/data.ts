import assert from "node:assert";
import { deflateRawSync } from "node:zlib";
import { CodePage437Encoder } from "../internal/cp437.js";
import { computeCrc32 } from "../internal/crc32.js";
import { DosDate } from "../internal/field-types.js";

// eslint-disable-next-line @typescript-eslint/require-await
export async function* asyncIterable(
  literals: TemplateStringsArray,
  ...values: unknown[]
): AsyncGenerator<Uint8Array> {
  for (const [index, literal] of literals.entries()) {
    if (literal) {
      yield Buffer.from(literal);
    }
    if (index < values.length) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      yield Buffer.from(`${values[index]}`);
    }
  }
}

export function base64(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return Buffer.from(baseTemplate(literals, ...values), "base64");
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function* base64iterable(
  literals: TemplateStringsArray,
  ...values: unknown[]
): AsyncGenerator<Uint8Array> {
  yield base64(literals, ...values);
}

export function bigUint(value: number): Uint8Array {
  assert(value >= 0 && value <= Number.MAX_SAFE_INTEGER);
  const buffer = Buffer.alloc(8);
  buffer.writeUint32LE(value >>> 0);
  buffer.writeUint32LE((value / 0x1_0000_0000) >>> 0, 4);
  return buffer;
}

export function cp437(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return new CodePage437Encoder().encode(baseTemplate(literals, ...values));
}

export function cp437length(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return shortUint(cp437(literals, ...values).byteLength);
}

export function crc32(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return longUint(computeCrc32(utf8(literals, ...values)));
}

export function data(...values: (string | Uint8Array)[]): Uint8Array {
  return Buffer.concat(
    values.map((value) => (typeof value === "string" ? fromHex(value) : value)),
  );
}

export function deflate(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return deflateRawSync(utf8(literals, ...values));
}

export function deflateLength32(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return longUint(deflateRawSync(utf8(literals, ...values)).byteLength);
}

export function dosDate(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  const dateString = baseTemplate(literals, ...values);
  assert(
    /^\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(dateString),
    "must be a valid ISO timestamp with second precision",
  );
  return longUint(new DosDate(dateString).getDosDateTime());
}

export function fromHex(value: string): Buffer {
  const noWhitespace = value.replaceAll(/\s/g, "");
  assert(/^[\da-f]*$/.test(noWhitespace), `not a hex string: ${value}`);
  return Buffer.from(noWhitespace, "hex");
}

export function hex(...parts: (string | Uint8Array)[]): string {
  const buffer = data(...parts);
  let output = "";

  // format in single bytes in groups of 8 to help debugging
  for (let byte = 0; byte < buffer.byteLength; ++byte) {
    // we know it's in bounds because the for loop checks
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    output += buffer[byte]!.toString(16).padStart(2, "0");

    if ((byte + 1) % 8 === 0) {
      output += "    ";
    } else if (byte + 1 < buffer.byteLength) {
      output += " ";
    }
  }

  return output;
}

export function longUint(value: number): Uint8Array {
  const buffer = Buffer.alloc(4);
  buffer.writeUint32LE(value);
  return buffer;
}

export function shortUint(value: number): Uint8Array {
  const buffer = Buffer.alloc(2);
  buffer.writeUint16LE(value);
  return buffer;
}

export function tinyUint(value: number): Uint8Array {
  const buffer = Buffer.alloc(1);
  buffer.writeUint8(value);
  return buffer;
}

export function utf8(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return Buffer.from(baseTemplate(literals, ...values));
}

export function utf8length(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return shortUint(utf8(literals, ...values).byteLength);
}

export function utf8length32(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return longUint(utf8(literals, ...values).byteLength);
}

function baseTemplate(
  literals: TemplateStringsArray,
  ...values: unknown[]
): string {
  let text = "";

  for (const [index, literal] of literals.entries()) {
    if (literal) {
      text += literal;
    }
    /* c8 ignore start */
    if (index < values.length) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      text += `${values[index]}`;
    }
    /* c8 ignore end */
  }

  return text;
}
