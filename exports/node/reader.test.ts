import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { describe, it } from "node:test";
import { generateZip } from "../../test-util/fixtures.ts";
import { ZipReader } from "./reader.ts";

describe("module exports/node/reader", () => {
  describe("class ZipReader", () => {
    describe("static open()", () => {
      it("can read a file from disk", async () => {
        // 120 MB file with 100 files of 1 MB each + roughly 2 MB central dir
        const data = generateZip({
          fileCount: 100,
          fileSize: 1024 * 1024,
          // pad out the central dir to force multiple chunks to be read
          fileCommentLength: 30 * 1024,
        });

        const path = join(tmpdir(), randomUUID());
        const output = createWriteStream(path);
        await pipeline(data, output);

        const reader = await ZipReader.open(path, {
          bufferSize: ZipReader.MinBufferSize,
        });

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
    });
  });
});
