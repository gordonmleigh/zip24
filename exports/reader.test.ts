import assert from "node:assert";
import { Readable } from "node:stream";
import { buffer, text } from "node:stream/consumers";
import { describe, it, mock } from "node:test";
import { assertInstanceOf } from "../test-util/assert.ts";
import {
  EmptyZip32,
  Zip32WithThreeEntries,
  generateZip,
} from "../test-util/fixtures.ts";
import {
  randomAccessReaderFromBuffer,
  type RandomAccessReader,
} from "../util/streams.ts";
import { ZipEntry, ZipEntryReader } from "./entry.ts";
import {
  CentralDirectoryBufferReader,
  CentralDirectoryStreamReader,
} from "./raw/central-directory-header.ts";
import { CompressionMethod, ZipPlatform, ZipVersion } from "./raw/constants.ts";
import { UnixFileAttributes } from "./raw/file-attributes.ts";
import { LocalFileHeader } from "./raw/local-file-header.ts";
import { ZipReader, type OpenStreamOptions } from "./reader.ts";

describe("exports/reader", () => {
  describe("class ZipReader", () => {
    it("can read a large zip", async () => {
      // 120 MB file with 100 files of 1 MB each + roughly 2 MB central dir
      const data = await buffer(
        generateZip({
          fileCount: 100,
          fileSize: 1024 * 1024,
          // pad out the central dir to force multiple chunks to be read
          fileCommentLength: 30 * 1024,
        }),
      );
      const reader = new ZipReader(
        randomAccessReaderFromBuffer(data),
        data.byteLength,
        { bufferSize: ZipReader.MinBufferSize },
      );

      let fileIndex = 0;
      for await (const file of reader) {
        assert.strictEqual(file.path, `path ${fileIndex}`);

        const expectedComment = `comment ${fileIndex}`;
        const commentRegexp = new RegExp(`^(${expectedComment})+$`);
        assert(commentRegexp.test(file.comment));

        const expectedData = `file${fileIndex.toString().padStart(6, "0")}`;
        const dataRegexp = new RegExp(`^(${expectedData})+$`);
        const data = await text(file);
        assert(dataRegexp.test(data));

        ++fileIndex;
      }

      assert.strictEqual(fileIndex, 100);
    });

    it("can read the central directory in multiple chunks", async () => {
      const data = await buffer(
        generateZip({
          fileCommentLength: 0xffff,
          fileCount: 30,
          fileSize: 10,
        }),
      );
      const reader = new ZipReader(
        randomAccessReaderFromBuffer(data),
        data.byteLength,
        {
          bufferSize: ZipReader.MinBufferSize,
        },
      );

      let fileIndex = 0;
      for await (const file of reader) {
        assert.strictEqual(file.path, `path ${fileIndex}`);
        ++fileIndex;
      }

      assert.strictEqual(fileIndex, 30);
    });

    it("can read a large Zip64", async () => {
      // 22 MB file with 100 files of 100 kB each + roughly 6 MB central dir
      // plus 10 MB extensible data
      const data = await buffer(
        generateZip({
          fileCount: 100,
          fileSize: 100 * 1024,
          // pad out the central dir to force multiple chunks to be read
          fileCommentLength: 0xffff,
          zip64: true,
          zip64ExtensibleDataLength: 10 * 1024 * 1024,
        }),
      );
      const reader = new ZipReader(
        randomAccessReaderFromBuffer(data),
        data.byteLength,
        { bufferSize: ZipReader.MinBufferSize },
      );

      let fileIndex = 0;
      for await (const file of reader) {
        assert.strictEqual(file.path, `path ${fileIndex}`);

        const expectedComment = `comment ${fileIndex}`;
        const commentRegexp = new RegExp(`^(${expectedComment})+$`);
        assert(commentRegexp.test(file.comment));

        const expectedData = `file${fileIndex.toString().padStart(6, "0")}`;
        const dataRegexp = new RegExp(`^(${expectedData})+$`);
        const data = await text(file);
        assert(dataRegexp.test(data));

        ++fileIndex;
      }

      assert.strictEqual(fileIndex, 100);
    });

    describe("get comment", () => {
      it("returns the zip file comment", async () => {
        const reader = new ZipReader(
          randomAccessReaderFromBuffer(EmptyZip32),
          EmptyZip32.byteLength,
        );
        await reader.open();
        assert.strictEqual(reader.comment, "Gordon is cool");
      });
    });

    describe("get entryCount", () => {
      it("returns the total number of entries in the zip", async () => {
        const reader = new ZipReader(
          randomAccessReaderFromBuffer(Zip32WithThreeEntries),
          Zip32WithThreeEntries.byteLength,
        );
        await reader.open();
        assert.strictEqual(reader.entryCount, 3);
      });
    });

    describe("files()", () => {
      it("iterates all the files", async () => {
        const reader = new ZipReader(
          randomAccessReaderFromBuffer(Zip32WithThreeEntries),
          Zip32WithThreeEntries.byteLength,
        );

        const files: ZipEntryReader[] = [];
        for await (const file of reader.files()) {
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

        assert.strictEqual(await text(file0), "this is the file 1 content");

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

        assert.strictEqual(await text(file1), "file 2 content goes right here");

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

        assert.strictEqual(await text(file2), "");
      });

      describe("the returned ZipEntry instance", () => {
        it("only reads the local header once", async () => {
          const bufferReader = randomAccessReaderFromBuffer(
            Zip32WithThreeEntries,
          );
          const read = mock.method(bufferReader, "read");

          const reader = new ZipReader(
            bufferReader,
            Zip32WithThreeEntries.byteLength,
          );

          const firstEntryResult = await reader.files().next();
          assert(!firstEntryResult.done);
          const firstEntry = firstEntryResult.value;

          const fileData1 = await text(firstEntry.open());
          const fileData2 = await text(firstEntry.open());

          const expectedContent = "this is the file 1 content";
          assert.strictEqual(fileData1, expectedContent);
          assert.strictEqual(fileData2, expectedContent);

          // central dir + file header + file data + file data
          assert.strictEqual(read.mock.callCount(), 4);

          // central dir read
          assert.partialDeepStrictEqual(read.mock.calls[0]?.arguments[0], {
            position: 0,
            length: Zip32WithThreeEntries.byteLength,
          });

          // file header read
          assert.partialDeepStrictEqual(read.mock.calls[1]?.arguments[0], {
            position: 0,
            length: LocalFileHeader.MinLength,
          });

          // data read 1
          assert.partialDeepStrictEqual(read.mock.calls[2]?.arguments[0], {
            position: 36,
            length: 26,
          });

          // data read 2
          assert.partialDeepStrictEqual(read.mock.calls[2]?.arguments[0], {
            position: 36,
            length: 26,
          });
        });

        it("uses the openStream implementation if provided", async () => {
          const bufferReader = randomAccessReaderFromBuffer(
            Zip32WithThreeEntries,
          );
          const read = mock.method(bufferReader, "read");

          const openStream = mock.fn((opts: OpenStreamOptions) =>
            Buffer.from("this is the file 1 content"),
          );

          const reader = new ZipReader(
            bufferReader,
            Zip32WithThreeEntries.byteLength,
            { openStream },
          );

          const firstEntryResult = await reader.files().next();
          assert(!firstEntryResult.done);
          const firstEntry = firstEntryResult.value;

          const fileData = await text(firstEntry.open());

          const expectedContent = "this is the file 1 content";
          assert.strictEqual(fileData, expectedContent);

          assert.strictEqual(openStream.mock.callCount(), 1);

          assert.deepStrictEqual(openStream.mock.calls[0]?.arguments[0], {
            startPosition: 36,
            length: 26,
          });

          // central dir + file header
          assert.strictEqual(read.mock.callCount(), 2);

          // central dir read
          assert.partialDeepStrictEqual(read.mock.calls[0]?.arguments[0], {
            position: 0,
            length: Zip32WithThreeEntries.byteLength,
          });

          // file header read
          assert.partialDeepStrictEqual(read.mock.calls[1]?.arguments[0], {
            position: 0,
            length: LocalFileHeader.MinLength,
          });
        });

        it("accepts a Node Readable from openStream", async () => {
          const openStream = mock.fn((opts: OpenStreamOptions) =>
            Readable.from(Buffer.from("this is the file 1 content")),
          );

          const reader = new ZipReader(
            randomAccessReaderFromBuffer(Zip32WithThreeEntries),
            Zip32WithThreeEntries.byteLength,
            { openStream },
          );

          const firstEntryResult = await reader.files().next();
          assert(!firstEntryResult.done);
          const firstEntry = firstEntryResult.value;

          const fileData = await text(firstEntry.open());

          const expectedContent = "this is the file 1 content";
          assert.strictEqual(fileData, expectedContent);

          assert.strictEqual(openStream.mock.callCount(), 1);
        });
      });
    });

    describe("[Symbol.asyncIterator]()", () => {
      it("passes through to files()", async () => {
        const reader = new ZipReader(
          randomAccessReaderFromBuffer(Zip32WithThreeEntries),
          Zip32WithThreeEntries.byteLength,
        );
        const files = [new ZipEntry(), new ZipEntry()];

        const filesMock = mock.method(
          reader,
          "files",

          async function* (): AsyncGenerator<ZipEntry> {
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

    describe("close()", () => {
      it("closes the underlying reader", async () => {
        let hasWaited = false;

        const close = mock.fn(async () => {
          await Promise.resolve();
          hasWaited = true;
        });

        const reader: RandomAccessReader = { close } as any;
        const zipReader = new ZipReader(reader, 0);

        await zipReader.close();

        assert.strictEqual(close.mock.callCount(), 1);
        assert.strictEqual(hasWaited, true);
      });

      it("disposes the underlying reader if it is AsyncDisposable", async () => {
        let hasWaited = false;

        const close = mock.fn(async () => {
          await Promise.resolve();
          hasWaited = true;
        });

        const reader: RandomAccessReader = {
          [Symbol.asyncDispose]: close,
        } as any;
        const zipReader = new ZipReader(reader, 0);

        await zipReader.close();

        assert.strictEqual(close.mock.callCount(), 1);
        assert.strictEqual(hasWaited, true);
      });

      it("disposes the underlying reader if it is Disposable", async () => {
        let hasWaited = false;

        const close = mock.fn(() => {
          hasWaited = true;
        });

        const reader: RandomAccessReader = { [Symbol.dispose]: close } as any;
        const zipReader = new ZipReader(reader, 0);

        await zipReader.close();

        assert.strictEqual(close.mock.callCount(), 1);
        assert.strictEqual(hasWaited, true);
      });
    });
  });

  describe("open()", () => {
    it("returns the same value if called multiple times", async () => {
      const data = await buffer(generateZip({ fileCount: 2 }));
      const reader = new ZipReader(
        randomAccessReaderFromBuffer(data),
        data.byteLength,
        { bufferSize: ZipReader.MinBufferSize },
      );

      const result1 = await reader.open();
      const result2 = await reader.open();

      assert.strictEqual(result1, result2);
    });

    describe("for standard zips", () => {
      it("reads the whole directory at once if less than buffer size", async () => {
        const data = await buffer(generateZip({ fileCount: 10 }));
        const dataReader = randomAccessReaderFromBuffer(data);
        const read = mock.method(dataReader, "read");

        const zipReader = new ZipReader(dataReader, data.byteLength, {
          bufferSize: ZipReader.MinBufferSize,
        });

        const result1 = await zipReader.open();

        assertInstanceOf(result1, CentralDirectoryBufferReader);
        assert.strictEqual(read.mock.callCount(), 1);
      });

      it("reads the directory in chunks if more than buffer size", async () => {
        const fileCount = 20;

        const data = await buffer(
          generateZip({ fileCount, fileCommentLength: 0xffff }),
        );
        const dataReader = randomAccessReaderFromBuffer(data);
        const read = mock.method(dataReader, "read");

        const bufferSize = ZipReader.MinBufferSize;

        const zipReader = new ZipReader(dataReader, data.byteLength, {
          bufferSize,
        });

        const directory = await zipReader.open();

        let entryCount = 0;
        let totalSize = 0;

        for await (const entry of directory) {
          ++entryCount;
          totalSize += entry.headerLength;
        }

        // make sure the test conditions are actually valid
        assert(directory.directoryLength > ZipReader.MinBufferSize);

        assert.strictEqual(entryCount, fileCount);
        assert.strictEqual(totalSize, directory.directoryLength);
        assertInstanceOf(directory, CentralDirectoryStreamReader);

        // we read one extra for the initial trailer read
        const totalBlocks = Math.ceil(totalSize / bufferSize) + 1;

        assert.strictEqual(read.mock.callCount(), totalBlocks);
      });
    });

    describe("for zip64", () => {
      it("reads the whole directory at once if less than buffer size", async () => {
        const data = await buffer(generateZip({ fileCount: 10, zip64: true }));
        const dataReader = randomAccessReaderFromBuffer(data);
        const read = mock.method(dataReader, "read");

        const zipReader = new ZipReader(dataReader, data.byteLength, {
          bufferSize: ZipReader.MinBufferSize,
        });

        const result1 = await zipReader.open();

        assertInstanceOf(result1, CentralDirectoryBufferReader);
        assert(result1.zip64);
        assert.strictEqual(read.mock.callCount(), 1);
      });
    });
  });

  describe("[Symbol.asyncDispose]()", () => {
    it("closes the underlying reader", async () => {
      let hasWaited = false;

      const close = mock.fn(async () => {
        await Promise.resolve();
        hasWaited = true;
      });

      const reader: RandomAccessReader = { close } as any;
      const zipReader = new ZipReader(reader, 0);

      await zipReader[Symbol.asyncDispose]();

      assert.strictEqual(close.mock.callCount(), 1);
      assert.strictEqual(hasWaited, true);
    });
  });

  describe("[Symbol.dispose]()", () => {
    it("closes the underlying reader", () => {
      const close = mock.fn();

      const reader: RandomAccessReader = { close } as any;
      const zipReader = new ZipReader(reader, 0);

      zipReader[Symbol.dispose]();

      assert.strictEqual(close.mock.callCount(), 1);
    });
  });
});
