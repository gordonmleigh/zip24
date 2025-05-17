/**
 * Like `Partial` but includes `undefined`, to support
 * `exactOptionalPropertyTypes`.
 */
export type DirtyPartial<T> = {
  [K in keyof T]?: T[K] | undefined;
};
