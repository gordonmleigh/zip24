/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */

// treat file as a module (or it doesn't work)
export {};

declare global {
  // this should be in DOM.AsyncIterable lib but it isn't released yet
  // see https://github.com/microsoft/TypeScript/blob/b1c52c53cc6c8cf35b19accfc3e29916489c821e/src/lib/dom.asynciterable.generated.d.ts#L12-L15
  interface ReadableStream<R = any> {
    [Symbol.asyncIterator](
      options?: ReadableStreamIteratorOptions,
    ): AsyncIterableIterator<R>;

    values(options?: ReadableStreamIteratorOptions): AsyncIterableIterator<R>;
  }

  // types are broken, see https://github.com/microsoft/TypeScript/issues/61680
  interface Uint8ArrayConstructor {
    new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
      length: number,
    ): Uint8Array<TArrayBuffer>;
    new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
      array: ArrayLike<number>,
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
