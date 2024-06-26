# zip24

A zip library for the modern age!

## Reading Zips

### From a random-access reader

You can open a zip reader directly from a file on Node as follows:

```ts
import { ZipReader } from "zip24/reader";

const reader = await ZipReader.open("my-stuff.zip");

for await (const file of reader) {
  // iterate through all the files
  console.log(file.path);
}
```

You can also manage the reader manually like this:

```ts
import { open } from "node:fs/promises";
import { ZipReader } from "zip24/reader";

const file = await open("my-stuff.zip");
// the size is needed so that the Central Directory can be
// found at the end of the file
const { size } = await file.stat();
const reader = await ZipReader.fromReader(file, size);

for await (const file of reader) {
  // iterate through all the files
  console.log(file.path);
}
```

You can create your own data source by implementing `RandomAccessReader`:

```ts
type RandomAccessReader = {
  close?: () => void | PromiseLike<void>;

  read: (
    options: RandomAccessReadOptions,
  ) => PromiseLike<RandomAccessReadResult>;
};

type RandomAccessReadOptions = {
  buffer: Uint8Array;
  offset?: number;
  length?: number;
  position: number;
};

type RandomAccessReadResult = {
  bytesRead: number;
  buffer: Uint8Array;
};
```

### From a Buffer, Uint8Array, ArrayBuffer, etc

```ts
import { ZipBufferReader } from "zip24/buffer";

// get the buffer somehow
const buffer = getZipBuffer();
const reader = new ZipBufferReader(buffer);

// iteration can be done synchronously
for (const file of reader) {
  console.log(file.path);
}
```

### From a stream

Nope! Reading a zip forwards from start to finish is something that the zip format is not designed to do. The authoritative index of all files contained in the zip (the Central Directory) is stored at the _end_ of the zip file, which means you can‘t start at the start. It could be possible to read the local headers, but these contain less information (e.g. they don‘t store the file attributes), and in theory could represent a deleted file which is no longer present in the Central Directory, which is allowed by the zip format. Also, the local header often doesn‘t contain the size of the data, meaning that determining the end of the data is quite tricky.

### Reading entries

The `ZipReader` and `ZipBufferReader` classes implement `AsyncIterable<ZipEntryLike>`. Additionally, `ZipBufferReader` implements `Iterable<ZipEntryLike>`. This lets you iterate through the entries using `for await` or `for...of` syntax.

```ts
for await (const file of reader) {
  // iterate through all the files
  console.log(file.path);
}
```

Each entry has the following interface:

```ts
type ZipEntryLike = AsyncIterable<Uint8Array> & {
  readonly attributes: FileAttributes;
  readonly flags: GeneralPurposeFlags;
  readonly internalAttributes: number;
  readonly lastModified: Date;
  readonly localHeaderOffset: number;
  readonly platformMadeBy: ZipPlatform;
  readonly versionMadeBy: ZipVersion;
  readonly versionNeeded: ZipVersion;
  readonly compressionMethod: CompressionMethod;
  readonly compressedSize: number;
  readonly crc32: number;
  readonly uncompressedSize: number;
  readonly comment: string;
  readonly path: string;

  readonly isDirectory: boolean;
  readonly isFile: boolean;

  readonly uncompressedData: ByteStream;

  readonly toBuffer: () => PromiseLike<Uint8Array>;
  readonly toReadableStream: () => ReadableStream;
  readonly toText: (encoding?: string) => PromiseLike<string>;
};
```

To get the data, you can use `toBuffer`, `toReadableStream` or `toText`. Additionally, you can iterate through chunks of data directly using the `AsyncIterable<Uint8Array>` interface.

## Writing Zips

```ts
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ZipWriter } from "zip24/writer";

const writer = new ZipWriter();
// start piping to the output already
const done = pipeline(writer, createWriteStream("my-file.zip"));

await writer.addFile(
  {
    path: "hello.txt",
    comment: "comment 1",
    attributes: new UnixFileAttributes(0o644),
  },
  "hello world",
);

await writer.addFile(
  {
    path: "uncompressed.txt",
    compressionMethod: CompressionMethod.Stored,
    lastModified: new Date(`1994-03-02T22:44:08Z`),
    comment: "comment 2",
  },
  "this will be stored as-is",
);

await writer.finalize("Gordon is cool");
await done;
```

## About this library

### Why `zip24`?

When I committed to writing it, I thought “it's 2024 and there's still not a built-in/standard/modern zip library for Node”.

### Why I wrote this

I had been using [Josh Wolfe‘s](https://github.com/thejoshwolfe) [yazl (Yet Another Zip Library)](https://github.com/thejoshwolfe/yazl) and [yauzl (Yet Another UnZip Library)](https://github.com/thejoshwolfe/yauzl). These are great and I owe a tonne of thanks to Josh, but I don‘t like the event-based interface of yauzl and there was a long period when these libraries were unmaintained, leading me to become interested in writing my own.

I wrote [unzip-iterable](https://github.com/gordonmleigh/unzip-iterable) to make a nice iterable interface for yauzl, but in the end I wanted to get into the bits and bytes myself. I also wanted to make a modern library, written in TypeScript, with types shipped in the same package.
