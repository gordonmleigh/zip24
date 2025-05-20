import crc32 from "crc-32";

export function computeCrc32(data: Uint8Array, seed?: number): number {
  const result = crc32.buf(data, seed);

  // convert to unsigned 32 bit
  // see https://github.com/SheetJS/js-crc32/issues/4
  return result >>> 0;
}
