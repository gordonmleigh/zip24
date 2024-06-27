import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { ZipEntryReader } from "../base/entry-reader.js";
import { CompressionMethod } from "../core/compression-core.js";
import { ZipPlatform, ZipVersion } from "../core/constants.js";
import { UnixFileAttributes } from "../core/file-attributes.js";
import { EmptyZip32, Zip32WithThreeEntries } from "../test-util/fixtures.js";
import { ZipBufferReader } from "./buffer.js";

describe("node/buffer", () => {
  describe("ZipBufferReader", () => {
    describe("comment", () => {
      it("returns the zip file comment", () => {
        const reader = new ZipBufferReader(EmptyZip32);
        assert.strictEqual(reader.comment, "Gordon is cool");
      });
    });

    describe("entryCount", () => {
      it("returns the total number of entries in the zip", () => {
        const reader = new ZipBufferReader(Zip32WithThreeEntries);
        assert.strictEqual(reader.entryCount, 3);
      });
    });

    describe("filesSync()", () => {
      it("iterates all the files", async () => {
        const reader = new ZipBufferReader(Zip32WithThreeEntries);

        const files: ZipEntryReader[] = [];
        for (const file of reader.filesSync()) {
          files.push(file);
        }

        assert.strictEqual(files.length, 3);

        //// FILE 0
        const file0 = files[0];
        assert(file0);
        assert.strictEqual(file0.versionMadeBy, ZipVersion.Deflate);
        assert.strictEqual(file0.platformMadeBy, ZipPlatform.UNIX);
        assert.strictEqual(file0.versionNeeded, ZipVersion.Deflate);
        assert.strictEqual(file0.flags.value, 0);
        assert.strictEqual(file0.compressionMethod, CompressionMethod.Stored);

        assert.strictEqual(
          file0.lastModified.toISOString(),
          "2023-04-05T11:22:34.000Z",
        );

        // these values calculated manually (with the node REPL)
        assert.strictEqual(file0.crc32, 776234292);
        assert.strictEqual(file0.compressedSize, 26);
        assert.strictEqual(file0.uncompressedSize, 26);

        assert.strictEqual(file0.path, "path 1");
        assert.strictEqual(file0.comment, "comment 1");
        assert(file0.attributes instanceof UnixFileAttributes);
        assert.strictEqual(file0.attributes.isDirectory, false);
        assert.strictEqual(file0.attributes.isFile, true);
        assert.strictEqual(file0.attributes.isReadOnly, false);
        assert.strictEqual(file0.attributes.isSymbolicLink, false);
        assert.strictEqual(file0.isDirectory, false);
        assert.strictEqual(file0.isFile, true);

        assert.strictEqual(await file0.toText(), "this is the file 1 content");

        //// FILE 1
        const file1 = files[1];
        assert(file1);
        assert.strictEqual(file1.versionMadeBy, ZipVersion.Deflate);
        assert.strictEqual(file1.platformMadeBy, ZipPlatform.UNIX);
        assert.strictEqual(file1.versionNeeded, ZipVersion.Deflate);
        assert.strictEqual(file1.flags.hasUtf8Strings, true);
        assert.strictEqual(file1.compressionMethod, CompressionMethod.Deflate);

        assert.strictEqual(
          file1.lastModified.toISOString(),
          "1994-03-02T22:44:08.000Z",
        );

        // these values calculated manually (with the node REPL)
        assert.strictEqual(file1.crc32, 1146718995);
        assert.strictEqual(file1.compressedSize, 32);
        assert.strictEqual(file1.uncompressedSize, 30);

        assert.strictEqual(file1.path, "path 2️⃣");
        assert.strictEqual(file1.comment, "comment 2️⃣");
        assert(file1.attributes instanceof UnixFileAttributes);
        assert.strictEqual(file1.attributes.isDirectory, false);
        assert.strictEqual(file1.attributes.isFile, true);
        assert.strictEqual(file1.attributes.isReadOnly, true);
        assert.strictEqual(file1.attributes.isSymbolicLink, false);
        assert.strictEqual(file1.isDirectory, false);
        assert.strictEqual(file1.isFile, true);

        assert.strictEqual(
          await file1.toText(),
          "file 2 content goes right here",
        );

        //// FILE 2
        const file2 = files[2];
        assert(file2);
        assert.strictEqual(file2.versionMadeBy, ZipVersion.Deflate);
        assert.strictEqual(file2.platformMadeBy, ZipPlatform.UNIX);
        assert.strictEqual(file2.versionNeeded, ZipVersion.Deflate);
        assert.strictEqual(file2.flags.value, 0);
        assert.strictEqual(file2.compressionMethod, CompressionMethod.Stored);

        assert.strictEqual(
          file2.lastModified.toISOString(),
          "2001-09-10T09:23:02.000Z",
        );

        assert.strictEqual(file2.crc32, 0);
        assert.strictEqual(file2.compressedSize, 0);
        assert.strictEqual(file2.uncompressedSize, 0);

        assert.strictEqual(file2.path, "path 3/");
        assert.strictEqual(file2.comment, "comment 3");
        assert(file2.attributes instanceof UnixFileAttributes);
        assert.strictEqual(file2.attributes.isDirectory, true);
        assert.strictEqual(file2.attributes.isFile, false);
        assert.strictEqual(file2.attributes.isReadOnly, false);
        assert.strictEqual(file2.attributes.isSymbolicLink, false);
        assert.strictEqual(file2.isDirectory, true);
        assert.strictEqual(file2.isFile, false);

        assert.strictEqual(await file2.toText(), "");
      });
    });

    describe("files()", () => {
      it("passes through to filesSync()", async () => {
        const reader = new ZipBufferReader(Zip32WithThreeEntries);
        const files = [new ZipEntryReader(), new ZipEntryReader()];

        const filesMock = mock.method(
          reader,
          "filesSync",
          function* (): Generator<ZipEntryReader> {
            for (const file of files) {
              yield file;
            }
          },
        );

        const result: unknown[] = [];
        for await (const file of reader.files()) {
          result.push(file);
        }

        assert.strictEqual(filesMock.mock.callCount(), 1);

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], files[0]);
        assert.strictEqual(result[1], files[1]);
      });
    });

    describe("[Symbol.iterator]()", () => {
      it("passes through to filesSync()", () => {
        const reader = new ZipBufferReader(Zip32WithThreeEntries);
        const files = [new ZipEntryReader(), new ZipEntryReader()];

        const filesMock = mock.method(
          reader,
          "filesSync",
          function* (): Generator<ZipEntryReader> {
            for (const file of files) {
              yield file;
            }
          },
        );

        const result: unknown[] = [];
        for (const file of reader) {
          result.push(file);
        }

        assert.strictEqual(filesMock.mock.callCount(), 1);

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], files[0]);
        assert.strictEqual(result[1], files[1]);
      });
    });

    describe("[Symbol.asyncIterator]()", () => {
      it("passes through to filesSync()", async () => {
        const reader = new ZipBufferReader(Zip32WithThreeEntries);
        const files = [new ZipEntryReader(), new ZipEntryReader()];

        const filesMock = mock.method(
          reader,
          "filesSync",
          function* (): Generator<ZipEntryReader> {
            for (const file of files) {
              yield file;
            }
          },
        );

        const result: unknown[] = [];
        for await (const file of reader) {
          result.push(file);
        }

        assert.strictEqual(filesMock.mock.callCount(), 1);

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], files[0]);
        assert.strictEqual(result[1], files[1]);
      });
    });
  });
});
