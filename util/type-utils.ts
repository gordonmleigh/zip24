export type Constructor<
  Instance = unknown,
  Arguments extends unknown[] = [],
> = new (...values: Arguments) => Instance;

/**
 * Like `Partial` but includes `undefined`, to support
 * `exactOptionalPropertyTypes`.
 */
export type DirtyPartial<T> = {
  [K in keyof T]?: T[K] | undefined;
};

export type StrictInstanceType<T> =
  T extends Constructor<infer I, any[]> ? I : never;
