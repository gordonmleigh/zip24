export type Constructor<
  Instance = unknown,
  Arguments extends unknown[] = [],
> = new (...values: Arguments) => Instance;

export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type StrictInstanceType<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Constructor<infer I, any[]> ? I : never;
