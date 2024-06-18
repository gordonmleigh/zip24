import assert from "node:assert";
import { describe, it } from "node:test";
import { cp437, data, utf8 } from "../testing/data.js";
import { ZipSignatureError } from "./errors.js";
import { readLocalHeaderSize } from "./local-entry.js";

describe("readLocalHeaderSize", () => {
  it("throws if the signature is invalid", () => {
    const buffer = data(
      /* 00 +04 */ "ffffffff", // signature  (0x04034b50)
      /* 04 +02 */ "1500", // version needed (21 = 2.1)
      /* 06 +02 */ "4100", // flags
      /* 08 +02 */ "0800", // compression method (8 = DEFLATE)
      /* 10 +02 */ "6a51", // last mod file time (10:11:20)
      /* 12 +02 */ "a656", // last mod file date, (2023-05-06)
      /* 14 +04 */ "12345678", // crc-32
      /* 18 +04 */ "87654321", // compressed size
      /* 22 +04 */ "12348765", // uncompressed size
      /* 26 +02 */ "0800", // file name length
      /* 28 +02 */ "0000", // extra field length
      /* 30 +08 */ cp437`ôöò/path`, // file name
      /* 38 +00 */ "", // extra field
    );

    assert.throws(
      () => {
        readLocalHeaderSize(buffer);
      },
      (error) => error instanceof ZipSignatureError,
    );
  });

  it("returns the total record length", () => {
    const buffer = data(
      "787cdb53a824260cbe32f44f795ac791",
      "9cb2a9d1be27c02c893728b7456ace9f", // nonsense (32 bytes)

      /* 00 +04 */ "504b0304", // signature  (0x04034b50)
      /* 04 +02 */ "1500", // version needed (21 = 2.1)
      /* 06 +02 */ "4100", // flags
      /* 08 +02 */ "0800", // compression method (8 = DEFLATE)
      /* 10 +02 */ "6a51", // last mod file time (10:11:20)
      /* 12 +02 */ "a656", // last mod file date, (2023-05-06)
      /* 14 +04 */ "12345678", // crc-32
      /* 18 +04 */ "87654321", // compressed size
      /* 22 +04 */ "12348765", // uncompressed size
      /* 26 +02 */ "0800", // file name length
      /* 28 +02 */ "0d00", // extra field length
      /* 30 +08 */ cp437`ôöò/path`, // file name

      "7570", // tag: Info-ZIP Unicode Path Extra Field
      "0900", // size: 9 bytes
      "01", // version
      "4311773a", // crc of "world"
      utf8`🥺`, // data
    );

    const result = readLocalHeaderSize(buffer, 32);
    assert.strictEqual(result, 51);
  });
});
