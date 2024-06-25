/* c8 ignore start */
/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable n/no-unsupported-features/node-builtins */

export function makeNonIterableReadableStream<T>(
  input: ReadableStream<T>,
): ReadableStream<T> {
  return new Proxy(input, {
    get(target, key) {
      // eslint-disable-next-line
      return key === Symbol.asyncIterator ? undefined : (target as any)[key];
    },

    has(target, key) {
      return key === Symbol.asyncIterator ? false : key in target;
    },
  });
}
