/* c8 ignore start */
import { fromHex } from "./data.js";

export type HexDiffOptions = {
  chunkSize?: number;
  colors?: boolean;
  leftColumnHeader?: string;
  offsetBase?: number;
  rightColumnHeader?: string;
};

export function hexDiff(
  left: string | Uint8Array,
  right: string | Uint8Array,
  options: HexDiffOptions = {},
): string {
  const {
    chunkSize = 8,
    colors = false,
    leftColumnHeader = "",
    offsetBase = 10,
    rightColumnHeader = "",
  } = options;

  const leftBuffer = typeof left === "string" ? fromHex(left) : left;
  const rightBuffer = typeof right === "string" ? fromHex(right) : right;
  const maxSize = Math.max(leftBuffer.byteLength, rightBuffer.byteLength);

  const rowOffsetWidth = Math.max(4, maxSize.toString(offsetBase).length);

  let output = "";

  const color = (n: number) => (x: string) =>
    colors ? `\u001B[${n}m${x}\u001B[0m` : x;

  // https://en.wikipedia.org/wiki/ANSI_escape_code#3-bit_and_4-bit
  const brightWhite = color(97);
  const brightBlack = color(90);
  const cyan = color(36);
  const green = color(32);
  const red = color(31);

  const header = cyan;
  const offset = brightBlack;
  const unchanged = brightWhite;

  const leftBlockOptions = { chunkSize, changed: green, unchanged };
  const rightBlockOptions = { chunkSize, changed: red, unchanged };
  const leftPadding = "".padStart(rowOffsetWidth + 4);

  // print column headers if supplied
  if (leftColumnHeader || rightColumnHeader) {
    const columnWidth = chunkSize * 3 - 1; // 2 digits plus space per byte

    const leftNamePadded = leftColumnHeader
      .slice(0, columnWidth)
      .padEnd(columnWidth);

    const rightNamePadded = rightColumnHeader
      .slice(0, columnWidth)
      .padEnd(columnWidth);

    output += header(`${leftPadding}${leftNamePadded}    ${rightNamePadded}\n`);
  }

  // print column offsets
  const columnOffsets = Array.from({ length: chunkSize })
    .map((_, index) => index.toString(offsetBase).padStart(2, "0"))
    .join(" ");

  output += offset(`${leftPadding}${columnOffsets}    ${columnOffsets}\n`);

  // print data
  for (let lineOffset = 0; lineOffset < maxSize; lineOffset += chunkSize) {
    const offsetText = lineOffset
      .toString(offsetBase)
      .padStart(rowOffsetWidth, "0");

    output += offset(`${offsetText}    `);

    output += formatHexDiffBlock(
      leftBuffer,
      rightBuffer,
      lineOffset,
      leftBlockOptions,
    );

    output += "   ";

    output += formatHexDiffBlock(
      rightBuffer,
      leftBuffer,
      lineOffset,
      rightBlockOptions,
    );

    output += "\n";
  }

  return output;
}

type FormatHexBlockOptions = {
  chunkSize: number;
  changed: (x: string) => string;
  unchanged: (x: string) => string;
};

function formatHexDiffBlock(
  ours: Uint8Array,
  theirs: Uint8Array,
  lineOffset: number,
  options: FormatHexBlockOptions,
): string {
  const { chunkSize, changed, unchanged } = options;
  let output = "";

  for (
    let byteOffset = lineOffset;
    byteOffset < lineOffset + chunkSize;
    ++byteOffset
  ) {
    const byteValue = ours[byteOffset];
    const byteText = byteValue?.toString(16).padStart(2, "0");

    if (byteText === undefined) {
      output += "   ";
    } else if (byteValue === theirs[byteOffset]) {
      output += unchanged(`${byteText} `);
    } else {
      output += changed(`${byteText} `);
    }
  }

  return output;
}
