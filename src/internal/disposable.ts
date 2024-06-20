import { hasExtraProperty } from "./assert.js";

export type AsyncCloseable = {
  close: () => PromiseLike<void>;
};

export type Closeable = {
  close: () => void;
};

export function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  return hasExtraProperty(value, Symbol.asyncDispose);
}

export function isDisposable(value: unknown): value is Disposable {
  return hasExtraProperty(value, Symbol.dispose);
}

export async function asyncDispose(value: unknown): Promise<void> {
  if (isAsyncDisposable(value)) {
    await value[Symbol.asyncDispose]();
  } else if (isDisposable(value)) {
    value[Symbol.dispose]();
  }
}

export async function asyncDisposeOrClose(
  value: Partial<AsyncCloseable | Closeable>,
): Promise<void> {
  if (isAsyncDisposable(value)) {
    await value[Symbol.asyncDispose]();
  } else if (isDisposable(value)) {
    value[Symbol.dispose]();
  } else if (value.close) {
    await value.close();
  }
}
