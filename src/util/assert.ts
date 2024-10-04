/* c8 ignore start */
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

export function hasExtraProperty<T, K extends PropertyKey>(
  object: T,
  key: K,
): object is T & Record<K, unknown> {
  // we check that the key isn't undefined because
  // object[undefined] === object["undefined"]
  // and we might end up passing an undefined key if a well-known symbol isn't
  // defined on the platform
  return (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustive
    key !== undefined &&
    object !== null &&
    object !== undefined &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (object as any)[key] !== undefined
  );
}
