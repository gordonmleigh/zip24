/* c8 ignore start */
import assert, { AssertionError } from "node:assert";
import { hexDiff } from "./display.js";

type AssertionErrorOptions = typeof AssertionError extends new (
  options?: infer T,
) => AssertionError
  ? T
  : never;

type AssertionErrorInfo = Omit<AssertionErrorOptions, "actual" | "expected">;

export class BufferAssertionError extends AssertionError {
  public constructor(options: AssertionErrorOptions = {}) {
    const {
      actual,
      expected,
      message = "Expected buffers to be byte-equal",
      operator = "bufferEqual",
      ...rest
    } = options;

    assert(actual instanceof Uint8Array && expected instanceof Uint8Array);

    const dump = hexDiff(actual, expected, {
      colors: true,
      leftColumnHeader: "actual",
      rightColumnHeader: "expected",
    });

    super({
      actual,
      expected,
      message: `${message}\n\n${dump}`,
      operator,
      ...rest,
    });
    this.name = "BufferAssertionError";
  }
}

export function assertBufferEqual(
  actual: Uint8Array | Iterable<Uint8Array>,
  expected: Uint8Array | Iterable<Uint8Array>,
  message?: string | AssertionErrorInfo,
): void {
  const actualBuffer =
    actual instanceof Uint8Array ? actual : Buffer.concat(Array.from(actual));

  const expectedBuffer =
    expected instanceof Uint8Array
      ? expected
      : Buffer.concat(Array.from(expected));

  if (Buffer.compare(actualBuffer, expectedBuffer) !== 0) {
    const options = typeof message === "string" ? { message } : message;

    throw new BufferAssertionError({
      stackStartFn: assertBufferEqual,
      ...options,
      actual: actualBuffer,
      expected: expectedBuffer,
    });
  }
}

export function assertInstanceOf<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends new (...parameters: any[]) => any,
>(
  actual: unknown,
  expected: T,
  message?: string | AssertionErrorInfo,
): asserts actual is InstanceType<T> {
  if (!(actual instanceof expected)) {
    const options = typeof message === "string" ? { message } : message;

    throw new AssertionError({
      message: `Expected instance of ${expected.name}`,
      operator: `instanceOf`,
      stackStartFn: assertInstanceOf,
      ...options,
      actual,
      expected,
    });
  }
}
