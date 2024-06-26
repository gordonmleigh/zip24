import { BitField } from "./binary.js";
import type { DecodedCentralHeader } from "./records.js";

export class GeneralPurposeFlags extends BitField {
  public static readonly HasEncryption = BitField.flag(0);
  public static readonly HasDataDescriptor = BitField.flag(3);
  public static readonly HasUtf8Strings = BitField.flag(11);
  public static readonly HasStrongEncryption = BitField.flag(6);

  public constructor(value = 0) {
    super(16, value);
  }

  public get hasEncryption(): boolean {
    return this.getBit(0);
  }

  public get hasDataDescriptor(): boolean {
    return this.getBit(3);
  }
  public set hasDataDescriptor(value: boolean) {
    this.setBit(3, value);
  }

  public get hasStrongEncryption(): boolean {
    return this.getBit(6);
  }

  public get hasUtf8Strings(): boolean {
    return this.getBit(11);
  }
  public set hasUtf8Strings(value: boolean) {
    this.setBit(11, value);
  }
}

type PublicEntryFields = Omit<
  DecodedCentralHeader,
  "flags" | "internalAttributes" | "localHeaderOffset" | "versionNeeded"
>;

export type ZipEntryOptions = {
  utf8?: boolean;
  zip64?: boolean;
};

export type ZipEntryInfo = Partial<PublicEntryFields> & ZipEntryOptions;
