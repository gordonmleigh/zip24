import crc32 from "crc-32";

export function computeCrc32(
  data: ArrayBuffer | ArrayBufferView,
  seed?: number
): number {
  const result = crc32.buf(
    ArrayBuffer.isView(data)
      ? data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data),
    seed
  );

  // convert to unsigned 32 bit
  // see https://github.com/SheetJS/js-crc32/issues/4
  return result >>> 0;
}
