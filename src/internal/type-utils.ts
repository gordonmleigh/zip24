/* c8 ignore start */

export type Constructor<
  Instance = unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Arguments extends unknown[] = any[],
> = new (...values: Arguments) => Instance;

export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;
