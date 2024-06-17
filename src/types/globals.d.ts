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
}
