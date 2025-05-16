/* eslint-disable @typescript-eslint/consistent-type-definitions */

declare global {
  // types are broken, see https://github.com/microsoft/TypeScript/issues/61680
  interface Uint8ArrayConstructor {
    new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
      length: number,
    ): Uint8Array<TArrayBuffer>;
    new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
      buffer: ArrayBuffer,
      byteOffset?: number,
      length?: number,
    ): Uint8Array<TArrayBuffer>;
    new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
      array: ArrayLike<number> | ArrayBuffer,
    ): Uint8Array<TArrayBuffer>;
  }
}
