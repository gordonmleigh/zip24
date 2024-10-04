import { assert } from "../util/assert.js";
import { BitField } from "../util/binary.js";
import { ZipPlatform } from "./constants.js";
import { ZipFormatError } from "./errors.js";

export type CommonAttributes = {
  isReadOnly: boolean;
  isDirectory: boolean;
  isFile: boolean;
  rawValue: number;
};

export class DosFileAttributes extends BitField implements CommonAttributes {
  public static readonly Directory = BitField.flag(4);
  public static readonly File = 0;
  public static readonly Hidden = BitField.flag(1);
  public static readonly ReadOnly = BitField.flag(0);
  public static readonly System = BitField.flag(2);

  // https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants
  public constructor(value = 0) {
    super(8, value);
  }

  public get isReadOnly(): boolean {
    return this.getBit(0);
  }
  public set isReadOnly(value: boolean) {
    this.setBit(0, value);
  }

  public get isHidden(): boolean {
    return this.getBit(1);
  }
  public set isHidden(value: boolean) {
    this.setBit(1, value);
  }

  public get isSystem(): boolean {
    return this.getBit(2);
  }
  public set isSystem(value: boolean) {
    this.setBit(2, value);
  }

  public get isDirectory(): boolean {
    return this.getBit(4);
  }
  public set isDirectory(value: boolean) {
    this.setBit(4, value);
  }

  public get isFile(): boolean {
    return !this.isDirectory;
  }
  public set isFile(value: boolean) {
    if (value) {
      this.isDirectory = false;
    } else {
      throw new RangeError(
        `unable to set isFile to false (set another type flag to true instead)`,
      );
    }
  }

  public get rawValue(): number {
    return this.value;
  }
  public set rawValue(value: number) {
    this.value = value;
  }
}

export class UnixFileAttributes extends BitField implements CommonAttributes {
  private static readonly ModeMask = 4095;
  private static readonly ModeTypeMask = 65024;
  private static readonly PermissionsMask = 511;
  private static readonly TypeMask = 61440;

  public static readonly DefaultPermissions = 420;
  public static readonly Directory = 16384;
  public static readonly File = 32768;
  public static readonly SymbolicLink = 40960;

  public static raw(value: number): number {
    return (value << 16) >>> 0;
  }

  // https://man7.org/linux/man-pages/man7/inode.7.html
  public constructor(value = 0) {
    super(16, value);
  }

  public get isDirectory(): boolean {
    return this.type === UnixFileAttributes.Directory;
  }
  public set isDirectory(value: boolean) {
    this.type = value ? UnixFileAttributes.Directory : UnixFileAttributes.File;
  }

  public get isExecutable(): boolean {
    // at least user has execute permission set
    return (this.permissions & 64) !== 0;
  }
  public set isExecutable(value: boolean) {
    if (value) {
      // set execute permission for everyone
      this.permissions = this.permissions | 73;
    } else {
      // clear execute permission for everyone
      this.permissions = this.permissions & 438;
    }
  }

  public get isFile(): boolean {
    return this.type === UnixFileAttributes.File;
  }
  public set isFile(value: boolean) {
    if (value) {
      this.type = UnixFileAttributes.File;
    } else {
      throw new RangeError(
        `unable to set isFile to false (set another type flag to true instead)`,
      );
    }
  }

  public get isReadOnly(): boolean {
    // no-one has write permission set
    return (this.permissions & 146) === 0;
  }
  public set isReadOnly(value: boolean) {
    if (value) {
      // clear write permission for everyone
      this.permissions = this.permissions & 365;
    } else {
      // set write permission for everyone
      this.permissions = this.permissions | 146;
    }
  }

  public get isSymbolicLink(): boolean {
    return this.type === UnixFileAttributes.SymbolicLink;
  }
  public set isSymbolicLink(value: boolean) {
    this.type = value
      ? UnixFileAttributes.SymbolicLink
      : UnixFileAttributes.File;
  }

  public get mode(): number {
    return this.value & UnixFileAttributes.ModeMask;
  }
  public set mode(value: number) {
    this.value =
      (this.value & UnixFileAttributes.TypeMask) |
      (value & UnixFileAttributes.ModeMask);
  }

  public get permissions(): number {
    return this.value & UnixFileAttributes.PermissionsMask;
  }
  public set permissions(value: number) {
    this.value =
      (this.value & UnixFileAttributes.ModeTypeMask) |
      (value & UnixFileAttributes.PermissionsMask);
  }

  public get rawValue(): number {
    return UnixFileAttributes.raw(this.value);
  }
  public set rawValue(value: number) {
    this.value = value >>> 16;
  }

  public get type(): number {
    return this.value & UnixFileAttributes.TypeMask;
  }
  public set type(value: number) {
    this.value =
      (this.value & UnixFileAttributes.ModeMask) |
      (value & UnixFileAttributes.TypeMask);
  }

  public override get value(): number {
    return super.value;
  }
  public override set value(value: number) {
    // set some defaults (file type, 0644 permissions)
    let finalValue = value;
    if (finalValue === 0) {
      finalValue = UnixFileAttributes.DefaultPermissions;
    }
    if ((finalValue & UnixFileAttributes.TypeMask) === 0) {
      finalValue |= UnixFileAttributes.File;
    }
    super.value = finalValue;
  }
}

const PlatformAttributes = {
  [ZipPlatform.DOS]: DosFileAttributes,
  [ZipPlatform.UNIX]: UnixFileAttributes,
};

export type PlatformAttributes = {
  [K in keyof typeof PlatformAttributes]: InstanceType<
    (typeof PlatformAttributes)[K]
  >;
};

export type AttributesPlatform<T> = {
  [K in keyof PlatformAttributes]: T extends PlatformAttributes[K] ? K : never;
}[keyof PlatformAttributes];

export type FileAttributes = PlatformAttributes[keyof PlatformAttributes];

export function makePlatformAttributes<P extends ZipPlatform>(
  platform: P,
  rawValue?: number,
): PlatformAttributes[P];
export function makePlatformAttributes(
  platform: ZipPlatform,
  rawValue?: number,
): PlatformAttributes[ZipPlatform] {
  const ctor = PlatformAttributes[platform];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustive
  if (!ctor) {
    throw new ZipFormatError(`unknown platform ${platform}`);
  }

  const instance = new ctor();

  if (rawValue !== undefined) {
    instance.rawValue = rawValue;
  }

  return instance;
}

export function getAttributesPlatform<A>(attributes: A): AttributesPlatform<A> {
  const platform = Object.entries(PlatformAttributes).find(
    ([, v]) => attributes instanceof v,
  )?.[0];
  if (!platform) {
    throw new TypeError(
      `expected attributes to be a valid platform attributes instance`,
    );
  }
  const platformNumber = Number.parseInt(platform);
  assert(Number.isInteger(platformNumber));
  return platformNumber as AttributesPlatform<A>;
}

export function isPlatformAttributes<P extends ZipPlatform>(
  platform: P,
  attributes: unknown,
): attributes is PlatformAttributes[P] {
  const ctor = PlatformAttributes[platform];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustive
  if (!ctor) {
    throw new ZipFormatError(`unknown platform ${platform}`);
  }
  return attributes instanceof ctor;
}
