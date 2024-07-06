import { BufferView, type BufferLike } from "../util/binary.js";
import { computeCrc32 } from "../util/crc32.js";
import { EncodedString } from "../util/encoded-string.js";
import {
  makeBuffer,
  type Deserializer,
  type Serializable,
} from "../util/serialization.js";
import type { StrictInstanceType } from "../util/type-utils.js";
import { ExtraFieldTag } from "./constants.js";
import { ZipFormatError, ZipSignatureError } from "./errors.js";

export type ExtraField = Serializable & {
  tag: number;
  dataSize: number;
};

export type ExtraFieldType<T extends ExtraField> = Deserializer<T>;

export type UnicodeExtraFieldTag =
  | ExtraFieldTag.UnicodeCommentField
  | ExtraFieldTag.UnicodePathField;

export class UnicodeExtraField implements ExtraField {
  // | offset | field                   | size |
  // | ------ | ----------------------- | ---- |
  // | 0      | tag (0x6375 or 0x7075)  | 2    |
  // | 2      | size                    | 2    |
  // | 4      | version (0x01)          | 1    |
  // | 5      | crc32 of _header_ value | 4    |
  // | 9      | utf-8 encoded value     | ...  |

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): UnicodeExtraField {
    const view = new BufferView(buffer, byteOffset, byteLength);

    const tag = view.readUint16LE(0) as ExtraFieldTag;
    this.validateTag(tag);

    const version = view.readUint8(4);
    if (version !== 1) {
      throw new ZipFormatError(
        `expected version 1 of unicode field, got ${version}`,
      );
    }

    const valueSize = view.readUint16LE(2) - 5;
    const crc32 = view.readUint32LE(5);
    const value = view.readString("utf8", 9, valueSize);

    return new UnicodeExtraField(tag, crc32, value);
  }

  private static validateTag(tag: number): asserts tag is UnicodeExtraFieldTag {
    if (
      tag !== (ExtraFieldTag.UnicodeCommentField as number) &&
      tag !== (ExtraFieldTag.UnicodePathField as number)
    ) {
      throw new ZipSignatureError("Info-ZIP unicode field", tag);
    }
  }

  private rawValueInternal: EncodedString;
  public crc32: number;

  public get dataSize(): number {
    // string plus crc32 and version
    return this.rawValueInternal.byteLength + 5;
  }

  public get value(): string {
    return this.rawValueInternal.toString();
  }
  public set value(value: string) {
    this.rawValueInternal = new EncodedString("utf8", value);
  }

  public constructor(
    public tag: UnicodeExtraFieldTag,
    crc32: number,
    value: string,
  ) {
    UnicodeExtraField.validateTag(tag);
    this.crc32 = crc32;
    this.rawValueInternal = new EncodedString("utf8", value);
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const encodedValue = new TextEncoder().encode(this.value);

    const view = makeBuffer(this.dataSize + 4, buffer, byteOffset, byteLength);

    view.writeUint16LE(this.tag, 0);
    view.writeUint16LE(view.byteLength - 4, 2);
    view.writeUint8(1, 4);
    view.writeUint32LE(this.crc32, 5);
    view.setBytes(9, encodedValue);

    return view.getOriginalBytes();
  }
}

export class UnknownExtraField implements ExtraField {
  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): UnknownExtraField {
    const view = new BufferView(buffer, byteOffset, byteLength);
    const tag = view.readUint16LE(0) as ExtraFieldTag;
    const size = view.readUint16LE(2);
    return new UnknownExtraField(tag, view.getOriginalBytes(4, size));
  }

  public tag: number;
  public data: Uint8Array;

  public get dataSize(): number {
    return this.data.byteLength;
  }

  public constructor(tag: number, data: Uint8Array) {
    this.tag = tag;
    this.data = data;
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const view = makeBuffer(this.dataSize + 4, buffer, byteOffset, byteLength);
    view.writeUint16LE(this.tag, 0);
    view.writeUint16LE(view.byteLength - 4, 2);
    view.setBytes(4, this.data);

    return view.getOriginalBytes();
  }
}

export type Zip64SizeFields = {
  compressedSize?: number;
  localHeaderOffset?: number;
  uncompressedSize?: number;
};

export class Zip64ExtraField implements ExtraField {
  // ## Zip64 Extended Information Extra Field (4.5.3):
  //
  // | offset | field                          | size |
  // | ------ | ------------------------------ | ---- |
  // | 0      | tag (0x0001)                   | 2    |
  // | 2      | size                           | 2    |
  // | 4      | uncompressed size (optional)   | 8    |
  // | ...    | compressed size (optional)     | 8    |
  // | ...    | local header offset (optional) | 8    |
  // | ...    | disk number (optional)         | 4    |

  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Zip64ExtraField {
    const view = new BufferView(buffer, byteOffset, byteLength);

    const tag = view.readUint16LE(0) as ExtraFieldTag;
    const totalSize = view.readUint16LE(2) + 4;

    if (tag !== ExtraFieldTag.Zip64ExtendedInfo) {
      throw new ZipSignatureError(
        "Zip64 extended information extra field",
        tag,
      );
    }

    const field = new Zip64ExtraField();
    let offset = 4;

    while (offset + 8 <= totalSize) {
      field.values.push(view.readUint64LE(offset));
      offset += 8;
    }

    return field;
  }

  public static from(fields: Zip64SizeFields): Zip64ExtraField {
    const field = new Zip64ExtraField();
    field.setValues(fields);
    return field;
  }

  public readonly tag = ExtraFieldTag.Zip64ExtendedInfo;

  public get dataSize(): number {
    return this.values.length * 8;
  }

  public values: number[];

  public constructor(values: Iterable<number> = []) {
    this.values = [...values];
  }

  public readFields(fields: Zip64SizeFields): void {
    let index = 0;

    if (fields.uncompressedSize === 0xffff_ffff) {
      if (index >= this.values.length) {
        throw new ZipFormatError("Zip64 field not long enough");
      }
      fields.uncompressedSize = this.values[index];
      ++index;
    }
    if (fields.compressedSize === 0xffff_ffff) {
      if (index >= this.values.length) {
        throw new ZipFormatError("Zip64 field not long enough");
      }
      fields.compressedSize = this.values[index];
      ++index;
    }
    if (fields.localHeaderOffset === 0xffff_ffff) {
      if (index >= this.values.length) {
        throw new ZipFormatError("Zip64 field not long enough");
      }
      fields.localHeaderOffset = this.values[index];
      ++index;
    }
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const view = makeBuffer(
      4 + 8 * this.values.length,
      buffer,
      byteOffset,
      byteLength,
    );
    view.writeUint16LE(this.tag, 0);
    view.writeUint16LE(view.byteLength - 4, 2);

    let offset = 4;
    for (const value of this.values) {
      view.writeUint64LE(value, offset);
      offset += 8;
    }

    return view.getOriginalBytes();
  }

  public setValues(fields: Zip64SizeFields): void {
    const values: number[] = [];

    if (fields.uncompressedSize !== undefined) {
      values.push(fields.uncompressedSize);
    }
    if (fields.compressedSize !== undefined) {
      values.push(fields.compressedSize);
    }
    if (fields.localHeaderOffset !== undefined) {
      values.push(fields.localHeaderOffset);
    }

    this.values = values;
  }
}

const knownExtraFields = {
  [ExtraFieldTag.UnicodeCommentField]: UnicodeExtraField,
  [ExtraFieldTag.UnicodePathField]: UnicodeExtraField,
  [ExtraFieldTag.Zip64ExtendedInfo]: Zip64ExtraField,
};

export type KnownExtraFieldTypes = {
  [K in keyof typeof knownExtraFields]: (typeof knownExtraFields)[K];
};

export type KnownExtraFields = {
  [K in keyof KnownExtraFieldTypes]: StrictInstanceType<
    KnownExtraFieldTypes[K]
  >;
};

export type ExtraFieldTypeFor<T> = T extends keyof KnownExtraFields
  ? KnownExtraFieldTypes[T]
  : typeof UnknownExtraField;

export type ExtraFieldFor<T> = T extends keyof KnownExtraFields
  ? StrictInstanceType<KnownExtraFieldTypes[T]>
  : UnknownExtraField;

function getExtraFieldTypeForTag<T extends number>(
  tag: T,
): ExtraFieldTypeFor<T> {
  if (tag in knownExtraFields) {
    return knownExtraFields[tag] as ExtraFieldTypeFor<T>;
  }
  return UnknownExtraField as ExtraFieldTypeFor<T>;
}

export class ExtraFieldCollection
  implements Iterable<ExtraField>, Serializable
{
  public static deserialize(
    buffer: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): ExtraFieldCollection {
    // | offset | field | size |
    // | ------ | ----- | ---- |
    // | 0      | tag   | 2    |
    // | 2      | size  | 2    |
    const view = new BufferView(buffer, byteOffset, byteLength);
    const fields: ExtraField[] = [];

    let offset = 0;
    while (offset < view.byteLength) {
      const tag = view.readUint16LE(offset) as ExtraFieldTag;
      const size = 4 + view.readUint16LE(offset + 2);

      const fieldType = getExtraFieldTypeForTag(tag);
      const field = fieldType.deserialize(view, offset);
      fields.push(field);

      offset += size;
    }

    return new ExtraFieldCollection(fields);
  }

  public fields: ExtraField[];

  public get byteLength(): number {
    return this.fields.reduce((total, field) => total + field.dataSize + 4, 0);
  }

  public constructor(fields: Iterable<ExtraField> = []) {
    this.fields = [...fields];
  }

  public fallbackUnicode(
    original: Uint8Array,
    tag: UnicodeExtraFieldTag,
  ): string {
    const field = this.getField(tag);
    if (field && field.crc32 === computeCrc32(original)) {
      return field.value;
    }
    return original.toString();
  }

  public serialize(
    buffer?: BufferLike,
    byteOffset?: number,
    byteLength?: number,
  ): Uint8Array {
    const view = makeBuffer(this.byteLength, buffer, byteOffset, byteLength);
    let offset = 0;

    for (const field of this.fields) {
      const chunk = field.serialize(view, offset);
      offset += chunk.byteLength;
    }

    return view.getOriginalBytes();
  }

  public [Symbol.iterator](): Iterator<ExtraField> {
    return this.fields[Symbol.iterator]();
  }

  public getField<K extends number>(tag: K): ExtraFieldFor<K> | undefined {
    return this.fields.find((x) => x.tag === tag) as ExtraFieldFor<K>;
  }
}
