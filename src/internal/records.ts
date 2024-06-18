import type {
  CompressionMethod,
  DosFileAttributes,
  GeneralPurposeFlags,
  UnixFileAttributes,
  ZipPlatform,
  ZipVersion,
} from "./field-types.js";

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

export type DecodedCentralHeader = CentralHeaderFixedFields &
  CentralHeaderDecodedVariableFields;

export type CompressionInfoFields = {
  compressedSize: number;
  compressionMethod: CompressionMethod;
  crc32: number;
  uncompressedSize: number;
};

export enum ExtendedDataTag {
  Unset = 0,
  Zip64ExtendedInfo = 0x01,
  UnicodeCommentField = 0x6375,
  UnicodePathField = 0x7075,
  Unix = 0x0d,
}
