import {
  cp437,
  cp437length,
  crc32,
  data,
  deflate,
  deflateLength32,
  dosDate,
  longUint,
  shortUint,
  utf8,
  utf8length,
  utf8length32,
} from "./data.js";

export const EmptyZip32 = data(
  "504b0506", // signature (0x06054b50)
  "0000", // number of this disk
  "0000", // central directory start disk
  "0000", // total entries this disk
  "0000", // total entries all disks
  "00000000", // size of the central directory
  "00000000", // central directory offset
  cp437length`Gordon is cool`, // .ZIP file comment length
  cp437`Gordon is cool`, // .ZIP file comment
);

export const Zip32WithThreeEntries = data(
  //// +0000 LOCAL ENTRY 1 HEADER (30+6+0 = 36 bytes)
  longUint(0x04034b50), // local header signature
  shortUint(21), // version needed (21 = 2.1)
  shortUint(0), // flags
  shortUint(0), // compression method (0 = NONE)
  dosDate`2023-04-05T11:22:34Z`, // last modified
  crc32`this is the file 1 content`, // crc32
  utf8length32`this is the file 1 content`, // compressed size
  utf8length32`this is the file 1 content`, // uncompressed size
  cp437length`path 1`, // file name length
  shortUint(0), // extra field length
  cp437`path 1`, // file name
  "", // extra field

  //// +0036 LOCAL ENTRY 1 CONTENT (26 bytes)
  utf8`this is the file 1 content`,

  //// +0062 LOCAL ENTRY 2 HEADER (30+12+0 = 42 bytes)
  longUint(0x04034b50), // local header signature
  shortUint(21), // version needed (21 = 2.1)
  shortUint(0), // flags
  shortUint(8), // compression method (8 = DEFLATE)
  dosDate`1994-03-02T22:44:08Z`, // last modified
  crc32`file 2 content goes right here`, // crc32
  deflateLength32`file 2 content goes right here`, // compressed size
  utf8length32`file 2 content goes right here`, // uncompressed size
  utf8length`path 2️⃣`, // file name length
  shortUint(0), // extra field length
  utf8`path 2️⃣`, // file name length
  "", // extra field

  //// +0104 LOCAL ENTRY 2 CONTENT (32 bytes)
  deflate`file 2 content goes right here`,

  //// +0136 LOCAL ENTRY 3 HEADER (30+7+0 = 36 bytes)
  longUint(0x04034b50), // local header signature
  shortUint(21), // version needed (21 = 2.1)
  shortUint(0), // flags
  shortUint(0), // compression method (0 = NONE)
  dosDate`2001-09-10T09:23:02Z`, // last modified
  crc32`this is the file 1 content`, // crc32
  longUint(0), // compressed size
  longUint(0), // uncompressed size
  cp437length`path 3/`, // file name length
  shortUint(0), // extra field length
  cp437`path 3/`, // file name
  "", // extra field

  //// +0173 LOCAL ENTRY 3 CONTENT (0 bytes)
  "",

  //// +0173 DIRECTORY ENTRY 1 (46+6+0+9 = 61 bytes)
  longUint(0x02014b50), // central directory header signature
  shortUint(21 | (3 << 8)), // version made by (21 = 2.1), platform (3 = Unix)
  shortUint(21), // version needed (21 = 2.1)
  shortUint(0), // flags
  shortUint(0), // compression method (0 = NONE)
  dosDate`2023-04-05T11:22:34Z`, // last modified
  crc32`this is the file 1 content`, // crc32
  utf8length32`this is the file 1 content`, // compressed size
  utf8length32`this is the file 1 content`, // uncompressed size
  cp437length`path 1`, // file name length
  shortUint(0), // extra field length
  cp437length`comment 1`, // file comment length
  shortUint(0), // disk number start
  shortUint(0), // internal file attributes
  longUint((0o10_0644 << 16) >>> 0), // external file attributes
  longUint(0), // relative offset of local header
  cp437`path 1`, // file name
  "", // extra field
  cp437`comment 1`, // the comment

  //// +0234 DIRECTORY ENTRY 2 (46+12+0+15 = 73 bytes)
  longUint(0x02014b50), // central directory header signature
  shortUint(21 | (3 << 8)), // version made by (21 = 2.1), platform (3 = Unix)
  shortUint(21), // version needed (21 = 2.1)
  shortUint(0b1000_0000_0000), // flags (+unicode)
  shortUint(8), // compression method (8 = DEFLATE)
  dosDate`1994-03-02T22:44:08Z`, // last modified
  crc32`file 2 content goes right here`, // crc32
  deflateLength32`file 2 content goes right here`, // compressed size
  utf8length32`file 2 content goes right here`, // uncompressed size
  utf8length`path 2️⃣`, // file name length
  shortUint(0), // extra field length
  utf8length`comment 2️⃣`, // file comment length
  shortUint(0), // disk number start
  shortUint(0), // internal file attributes
  longUint((0o10_0444 << 16) >>> 0), // external file attributes
  longUint(62), // relative offset of local header
  utf8`path 2️⃣`, // file name
  "", // extra field
  utf8`comment 2️⃣`, // the comment

  //// +0307 DIRECTORY ENTRY 3 (46+7+0+9 = 62 bytes)
  longUint(0x02014b50), // central directory header signature
  shortUint(21 | (3 << 8)), // version made by (21 = 2.1), platform (3 = Unix)
  shortUint(21), // version needed (21 = 2.1)
  shortUint(0), // flags
  shortUint(0), // compression method (0 = NONE)
  dosDate`2001-09-10T09:23:02Z`, // last modified
  "00000000", // crc-32
  "00000000", // compressed size
  "00000000", // uncompressed size
  cp437length`path 3/`, // file name length
  shortUint(0), // extra field length
  cp437length`comment 3`, // file comment length
  shortUint(0), // disk number start
  shortUint(0), // internal file attributes
  longUint((0o4_0755 << 16) >>> 0), // external file attributes
  longUint(136), // relative offset of local header
  cp437`path 3/`, // file name
  "", // extra field
  cp437`comment 3`, // the comment

  //// +0369 End of Central Directory Record
  longUint(0x06054b50), // EOCDR signature
  shortUint(0), // number of this disk
  shortUint(0), // central directory start disk
  shortUint(3), // total entries this disk
  shortUint(3), // total entries all disks
  longUint(196), // size of the central directory
  longUint(173), // central directory offset
  cp437length`Gordon is cool`, // .ZIP file comment length
  cp437`Gordon is cool`, // .ZIP file comment
);
