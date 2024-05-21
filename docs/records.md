# Records

This file contains documentation for the records in a zip file.

## Local File Header (4.3.7)

| offset | field                     | size |
| ------ | ------------------------- | ---- |
| 0      | signature (0x04034b50)    | 4    |
| 4      | version needed to extract | 2    |
| 6      | general purpose bit flag  | 2    |
| 8      | compression method        | 2    |
| 10     | last mod file time        | 2    |
| 12     | last mod file date        | 2    |
| 14     | crc-32                    | 4    |
| 18     | compressed size           | 4    |
| 22     | uncompressed size         | 4    |
| 26     | file name length          | 2    |
| 28     | extra field length        | 2    |
| 30     | file name                 | ...  |
| ...    | extra field               | ...  |

## 32-bit Data Descriptor (4.3.9)

This record has an optional signature value of `0x08074b50` which precedes the other fields. Writers SHOULD output the signature value.

| offset | field             | size |
| ------ | ----------------- | ---- |
| 0      | crc-32            | 4    |
| 4      | compressed size   | 4    |
| 8      | uncompressed size | 4    |
| 12     | (end)             |      |

| offset | field                  | size |
| ------ | ---------------------- | ---- |
| 0      | signature (0x08074b50) | 4    |
| 4      | crc-32                 | 4    |
| 8      | compressed size        | 4    |
| 12     | uncompressed size      | 4    |
| 16     | (end)                  |      |

## 64-bit Data Descriptor (4.3.9)

This record has an optional signature value of `0x08074b50` which precedes the other fields. Writers SHOULD output the signature value.

| offset | field             | size |
| ------ | ----------------- | ---- |
| 0      | crc-32            | 4    |
| 4      | compressed size   | 8    |
| 12     | uncompressed size | 8    |
| 20     | (end)             |      |

| offset | field                  | size |
| ------ | ---------------------- | ---- |
| 0      | signature (0x08074b50) | 4    |
| 4      | crc-32                 | 4    |
| 8      | compressed size        | 8    |
| 16     | uncompressed size      | 8    |
| 24     | (end)                  |      |

## Central Directory Header (4.3.12)

| offset | field                           | size |
| ------ | ------------------------------- | ---- |
| 0      | signature (0x02014b50)          | 4    |
| 4      | version made by                 | 2    |
| 6      | version needed to extract       | 2    |
| 8      | general purpose bit flag        | 2    |
| 10     | compression method              | 2    |
| 12     | last mod file time              | 2    |
| 14     | last mod file date              | 2    |
| 16     | crc-32                          | 4    |
| 20     | compressed size                 | 4    |
| 24     | uncompressed size               | 4    |
| 28     | file name length                | 2    |
| 30     | extra field length              | 2    |
| 32     | file comment length             | 2    |
| 34     | disk number start               | 2    |
| 36     | internal file attributes        | 2    |
| 38     | external file attributes        | 4    |
| 42     | relative offset of local header | 4    |
| 46     | file name                       | ...  |
| ...    | extra field                     | ...  |
| ...    | file comment                    | ...  |

## Zip64 End of Central Directory Record (4.3.14)

| offset | field                         | size |
| ------ | ----------------------------- | ---- |
| 0      | signature (0x06064b50)        | 4    |
| 4      | record size                   | 8    |
| 12     | version made by               | 2    |
| 14     | version needed to extract     | 2    |
| 16     | number of this disk           | 4    |
| 20     | central directory start disk  | 4    |
| 24     | total entries this disk       | 8    |
| 32     | total entries on all disks    | 8    |
| 40     | size of the central directory | 8    |
| 48     | central directory offset      | 8    |
| 56     | (end)                         |      |

## Zip64 End of Central Directory Locator (4.3.15)

| offset | field                        | size |
| ------ | ---------------------------- | ---- |
| 0      | signature (0x07064b50)       | 4    |
| 4      | central directory start disk | 4    |
| 8      | central directory offset     | 8    |
| 16     | total number of disks        | 4    |
| 20     | (end)                        |      |

## End of Central Directory Record (4.3.16)

| offset | field                         | size |
| ------ | ----------------------------- | ---- |
| 0      | signature (0x06054b50)        | 4    |
| 4      | number of this disk           | 2    |
| 6      | central directory start disk  | 2    |
| 8      | total entries this disk       | 2    |
| 10     | total entries on all disks    | 2    |
| 12     | size of the central directory | 4    |
| 16     | central directory offset      | 4    |
| 20     | file comment length           | 2    |
| 22     | file comment                  | ...  |

## Zip64 Extended Information Extra Field (4.5.3):

| offset | field                          | size |
| ------ | ------------------------------ | ---- |
| 0      | tag (0x0001)                   | 2    |
| 2      | size                           | 2    |
| 4      | uncompressed size (optional)   | 8    |
| ...    | compressed size (optional)     | 8    |
| ...    | local header offset (optional) | 8    |
| ...    | disk number (optional)         | 4    |

## Info-ZIP Unicode Comment Extra Field (4.6.8)

| offset | field                   | size |
| ------ | ----------------------- | ---- |
| 0      | tag (0x6375)            | 2    |
| 2      | size                    | 2    |
| 4      | version (0x01)          | 1    |
| 5      | crc32 of _header_ value | 4    |
| 9      | utf-8 encoded value     | ...  |
