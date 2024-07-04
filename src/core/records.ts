import type { CompressionMethod } from "./compression-core.js";
import type { ZipPlatform, ZipVersion } from "./constants.js";
import type { FileAttributes } from "./file-attributes.js";
import type { GeneralPurposeFlags } from "./flags.js";

export type LocalHeaderBase = {
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  flags: GeneralPurposeFlags;
  lastModified: Date;
  versionNeeded: ZipVersion;
  uncompressedSize: number;
};

export type RawLocalHeader = LocalHeaderBase & {
  extraField?: Uint8Array;
  path: Uint8Array;
};

export type CentralDirectory = {
  comment: string;
  count: number;
  offset: number;
  size: number;
  zip64?: CentralDirectory64VersionInfo;
};

export type CentralDirectory64 = Required<CentralDirectory>;

export type CentralDirectory64VersionInfo = {
  platformMadeBy: ZipPlatform;
  versionMadeBy: ZipVersion;
  versionNeeded: ZipVersion;
};

export type CentralHeaderBase = {
  attributes: FileAttributes;
  flags: GeneralPurposeFlags;
  internalAttributes: number;
  lastModified: Date;
  localHeaderOffset: number;
  platformMadeBy: ZipPlatform;
  versionMadeBy: ZipVersion;
  versionNeeded: ZipVersion;
  compressionMethod: CompressionMethod;
  compressedSize: number;
  crc32: number;
  uncompressedSize: number;
};

export type CentralHeaderLengthFields = {
  commentLength: number;
  extraFieldLength: number;
  pathLength: number;
};

export type CentralHeaderFixedFields = CentralHeaderBase &
  CentralHeaderLengthFields;

export type CentralHeaderDecodedVariableFields = {
  comment: string;
  path: string;
};

export type CentralHeaderRawVariableFields = {
  comment: Uint8Array;
  extraField?: Uint8Array;
  path: Uint8Array;
};

export type DecodedCentralHeader = CentralHeaderBase &
  CentralHeaderDecodedVariableFields;

export type DecodedCentralHeaderWithLengths = DecodedCentralHeader &
  CentralHeaderLengthFields;

export type RawCentralHeader = CentralHeaderBase &
  CentralHeaderRawVariableFields;

export type Zip64ExtraField = {
  compressedSize: number;
  localHeaderOffset?: number;
  uncompressedSize: number;
};

export type PublicEntryFields = Omit<
  DecodedCentralHeader,
  "flags" | "internalAttributes" | "localHeaderOffset" | "versionNeeded"
>;

export type ZipEntryOptions = {
  utf8?: boolean;
  zip64?: boolean;
};

export type ZipEntryInfo = Partial<PublicEntryFields> & ZipEntryOptions;