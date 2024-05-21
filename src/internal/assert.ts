export class AssertionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssertionError";
  }
}

export function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function assertSignature(
  actual: number,
  expected: number,
  name: string,
): void {
  if (actual !== expected) {
    throw new AssertionError(
      `invalid signature for ${name} ` +
        `(expected ${expected.toString(16).padStart(8, "0")}, ` +
        `got ${actual.toString(16).padStart(8, "0")})`,
    );
  }
}

export function hasProperty<T, K extends PropertyKey>(
  object: T,
  key: K,
): object is T &
  (K extends keyof T ? Pick<Required<T>, K> : Record<K, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return (object as any)[key] !== undefined;
}
