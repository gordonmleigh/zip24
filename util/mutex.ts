export class Mutex {
  private readonly queue: (() => void)[] = [];

  private locked = false;

  public async enter(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  public exit(): void {
    const next = this.queue.shift();

    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  public synchronize<Return, Arguments extends unknown[]>(
    action: (...a: Arguments) => PromiseLike<Return>,
  ): (...a: Arguments) => PromiseLike<Return> {
    return async (...a: Arguments): Promise<Return> => {
      try {
        await this.enter();
        return await action(...a);
      } finally {
        this.exit();
      }
    };
  }
}
