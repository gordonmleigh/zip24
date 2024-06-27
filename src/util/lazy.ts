export function lazy<T>(factory: () => T): () => T {
  let init = false;
  let value: T;

  return () => {
    if (init) {
      return value;
    }
    init = true;
    value = factory();
    return value;
  };
}
