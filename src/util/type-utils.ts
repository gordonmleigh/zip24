export type Constructor<
  Instance = unknown,
  Arguments extends unknown[] = [],
> = new (...values: Arguments) => Instance;

export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;
