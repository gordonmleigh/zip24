import { CodePage437Encoder } from "../internal/cp437.js";

export function cp437(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return new CodePage437Encoder().encode(baseTemplate(literals, ...values));
}

export function data(...hex: (string | Uint8Array)[]): Uint8Array {
  return Buffer.concat(
    hex.map((x) => (typeof x === "string" ? Buffer.from(x, "hex") : x)),
  );
}

export function utf8(
  literals: TemplateStringsArray,
  ...values: unknown[]
): Uint8Array {
  return Buffer.from(baseTemplate(literals, ...values));
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
