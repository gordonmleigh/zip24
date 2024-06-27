export class ZipError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

export class MultiDiskError extends ZipError {
  public constructor() {
    super(`multi-disk zips not supported`, "E_ZIP_MULTI_DISK");
    this.name = "MultiDiskError";
  }
}

export class ZipFormatError extends ZipError {
  public constructor(message: string) {
    super(message, "E_ZIP_FORMAT");
    this.name = "ZipFormatError";
  }
}

export class ZipSignatureError extends ZipFormatError {
  public constructor(recordName: string, actual: number) {
    super(`invalid signature for ${recordName} (${actual.toString(16)})`);
    this.name = "ZipSignatureError";
  }
}
