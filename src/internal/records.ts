import type {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
} from "./field-types.js";

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

export type CentralHeaderBase = {
  attributes: DosFileAttributes | UnixFileAttributes;
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

export type CompressionInfoFields = {
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  uncompressedSize: number;
};

export type DataDescriptor = {
  compressedSize: number;
  crc32: number;
  uncompressedSize: number;
};

export type Zip64ExtraField = {
  compressedSize: number;
  localHeaderOffset?: number;
  uncompressedSize: number;
};

export enum ExtendedDataTag {
  Unset = 0,
  Zip64ExtendedInfo = 0x01,
  UnicodeCommentField = 0x6375,
  UnicodePathField = 0x7075,
  Unix = 0x0d,
}
